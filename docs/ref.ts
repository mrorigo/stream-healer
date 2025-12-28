/**
 * A robust, schema-aware state machine for healing JSON streams on the fly.
 * * Capabilities:
 * 1. Preamble Stripping: Removes conversational text before JSON starts.
 * 2. Auto-Closing: Fixes unclosed braces/brackets.
 * 3. Schema Enforcement: Injects missing required fields with null values if stream truncates.
 */

interface StackFrame {
  char: string;         // The expected closing char ('}' or ']')
  isObject: boolean;    // Is this an object or array?
  keysSeen: Set<string>; // If object, which keys have we encountered?
  currentKey: string | null; // If inside object, what key are we currently parsing?
}

// Minimal definition for JSON Schema traversal
interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  $ref?: string; // (Note: Full ref resolution is complex, this is a basic stub)
}

export class StreamHealer {
  private buffer: string = '';
  private hasStartedJson: boolean = false;

  // The Stack now tracks structural context, not just chars
  private stack: StackFrame[] = [];

  private inString: boolean = false;
  private isEscaped: boolean = false;
  private pendingKeyBuffer: string = ''; // Used to capture key names

  // Safety: If we buffer too much without finding JSON, we assume it's just text.
  private readonly MAX_PREAMBLE_BUFFER = 500;

  constructor(private schema?: JsonSchema) { }

  /**
   * Process a chunk of text from the stream.
   * Returns the "safe" part of the chunk to send to the client.
   */
  process(chunk: string): string {
    // Phase 1: Waiting for JSON start (Preamble stripping)
    if (!this.hasStartedJson) {
      this.buffer += chunk;

      const startIdx = this.buffer.search(/[{\[]/);

      if (startIdx !== -1) {
        this.hasStartedJson = true;
        const validPayload = this.buffer.slice(startIdx);
        this.buffer = '';
        this.analyzeState(validPayload);
        return validPayload;
      }

      if (this.buffer.length > this.MAX_PREAMBLE_BUFFER) {
        this.hasStartedJson = true;
        const flushed = this.buffer;
        this.buffer = '';
        this.analyzeState(flushed);
        return flushed;
      }
      return '';
    }

    // Phase 2: JSON Streaming
    this.analyzeState(chunk);
    return chunk;
  }

  /**
   * Called when stream ends. 
   * Returns closing characters AND injects missing required fields based on Schema.
   */
  finish(): string {
    if (!this.hasStartedJson && this.buffer.length === 0) return '';
    if (!this.hasStartedJson && this.buffer.length > 0) return this.buffer;

    let closure = '';

    // 1. Close open string
    if (this.inString) {
      closure += '"';
      // If we were parsing a key, we consider it done
      if (this.stack.length > 0 && this.stack[this.stack.length - 1].isObject) {
        this.stack[this.stack.length - 1].keysSeen.add(this.pendingKeyBuffer);
      }
    }

    // 2. Walk up the stack (from deepest to root)
    // We iterate backwards to close the most recently opened first
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame = this.stack[i];

      // SCHEMA HEALING:
      // If this is an object, checks what keys we missed and inject them
      if (frame.isObject && this.schema) {
        const missing = this.getMissingRequiredKeys(i);
        if (missing.length > 0) {
          // If we are auto-closing, we need a comma before adding new keys
          // UNLESS the object was empty to begin with.
          // Simplification: We assume if we are deep in stack, we might need a comma.
          // A robust impl would track `hasProperties` flag. 
          // For safety, we prepend comma if we have seen keys.
          const needsComma = frame.keysSeen.size > 0;

          const injection = missing.map(k => `"${k}":null`).join(',');
          closure += (needsComma ? ',' : '') + injection;
        }
      }

      closure += frame.char;
    }

    return closure;
  }

  /**
   * Updates the internal state machine.
   * Now tracks Object Keys to allow for schema validation.
   */
  private analyzeState(text: string): void {
    for (const char of text) {
      if (this.inString) {
        if (this.isEscaped) {
          this.isEscaped = false;
        } else if (char === '\\') {
          this.isEscaped = true;
        } else if (char === '"') {
          this.inString = false;

          // End of string. Was it a key?
          // If we are in an object and currentKey is null, this string was a key.
          // (This is a heuristic: strict JSON is "key": value. We assume standard formatting)
          const top = this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
          if (top && top.isObject && top.currentKey === null) {
            // We just finished reading a key string
            top.currentKey = this.pendingKeyBuffer;
            top.keysSeen.add(this.pendingKeyBuffer);
          }
        } else {
          // Accumulate key name if we are potentially reading a key
          const top = this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
          if (top && top.isObject && top.currentKey === null) {
            this.pendingKeyBuffer += char;
          }
        }
      } else {
        // State transitions
        if (char === '"') {
          this.inString = true;
          this.pendingKeyBuffer = ''; // Reset key buffer
        } else if (char === ':') {
          // Colon indicates the key is definitely done and we are moving to value
          // (No-op here, mainly for confirmation)
        } else if (char === ',') {
          // Comma resets the current key expectation for the object
          const top = this.stack.length > 0 ? this.stack[this.stack.length - 1] : null;
          if (top && top.isObject) {
            top.currentKey = null;
          }
        } else if (char === '{') {
          this.stack.push({ char: '}', isObject: true, keysSeen: new Set(), currentKey: null });
        } else if (char === '[') {
          this.stack.push({ char: ']', isObject: false, keysSeen: new Set(), currentKey: null });
        } else if (char === '}' || char === ']') {
          if (this.stack.length > 0 && this.stack[this.stack.length - 1].char === char) {
            this.stack.pop();
          }
        }
      }
    }
  }

  /**
   * Helper: Traverse the stack/schema to find missing keys for a specific stack frame.
   */
  private getMissingRequiredKeys(stackIndex: number): string[] {
    if (!this.schema) return [];

    // 1. Resolve the sub-schema for the current stack frame
    // We trace the path from root (0) to stackIndex
    let currentSchema: JsonSchema | undefined = this.schema;

    for (let i = 0; i <= stackIndex; i++) {
      if (!currentSchema) break;
      const frame = this.stack[i];

      if (i === stackIndex) {
        // We reached the target frame. Check requirements.
        if (currentSchema.type === 'object' && currentSchema.required) {
          return currentSchema.required.filter(req => !frame.keysSeen.has(req));
        }
        return [];
      }

      // Navigate down to the next level
      // If current is array, we look at `items`
      if (!frame.isObject && currentSchema.type === 'array' && currentSchema.items) {
        currentSchema = currentSchema.items;
      }
      // If current is object, we need to know WHICH property we are in.
      // Limitation: The stack only knows we are in *an* object. 
      // It doesn't track *which* property's value we are currently expanding 
      // unless we store that in the parent frame.
      else if (frame.isObject && currentSchema.properties) {
        // To resolve the schema for the CHILD (stack[i+1]), we need to know 
        // what key stack[i] was processing when stack[i+1] started.
        // The simple stack above doesn't persist history of keys, only current.
        // However, `frame.currentKey` holds the key we are *currently* inside.
        if (frame.currentKey && currentSchema.properties[frame.currentKey]) {
          currentSchema = currentSchema.properties[frame.currentKey];
        } else {
          // If we can't resolve path, abort schema healing for this branch
          currentSchema = undefined;
        }
      } else {
        currentSchema = undefined;
      }
    }
    return [];
  }
}