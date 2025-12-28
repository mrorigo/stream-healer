# 🏥 openai-json-stream-healer

> A robust library and proxy for repairing broken JSON streams from LLMs, ensuring strict schema compliance and structural integrity.

[![Tests](https://img.shields.io/badge/tests-31%20passing-brightgreen)]() [![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)]() [![Bun](https://img.shields.io/badge/Bun-1.0-orange)]()

## 🎯 Why stream-healer?

LLMs frequently produce **broken JSON** when streaming responses:
- 🗣️ Conversational preambles: `"Sure! Here's the JSON: {\"data\": ..."`
- 🔓 Unclosed structures: `{\"users\": [{\"name\": \"Alice\"` (missing `}]}`)
- 📋 Missing required fields: Schema expects `email` but LLM stops early
- 🌊 Truncated streams: Connection drops mid-response

**openai-json-stream-healer** fixes all of these issues in real-time, making LLM JSON output production-ready.

## ✨ Features

| Feature                  | Description                                            |
| ------------------------ | ------------------------------------------------------ |
| 🔧 **Preamble Stripping** | Automatically removes conversational text before JSON  |
| 🔒 **Auto-Closing**       | Fixes unclosed braces, brackets, and strings           |
| 📋 **Schema Enforcement** | Injects missing fields with `default` values or `null` |
| 🌊 **Streaming Support**  | Works with both streaming and non-streaming responses  |
| 🔌 **OpenAI Compatible**  | Drop-in proxy for any OpenAI-style API                 |
| 🦙 **Ollama Ready**       | Pre-configured for local Ollama (localhost:11434)      |
| ⚡ **Zero Dependencies**  | Built on Bun's native APIs                             |
| 🧪 **Fully Tested**       | 32 tests covering all edge cases                       |

## 📦 Installation

```bash
bun install
```

## 🚀 Quick Start

### Option 1: Proxy Server (Recommended)

Start the healing proxy in front of your LLM:

```bash
bun run src/index.ts
```

```
🏥 Stream Healer Proxy running on http://localhost:1143
📡 Forwarding to: http://localhost:11434/v1
🤖 Default model: gemma3:4b
```

Now make requests through the proxy:

```bash
curl -X POST http://localhost:1143/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma3:4b",
    "messages": [
      {"role": "user", "content": "Generate a user profile with name, email, and age"}
    ],
    "response_format": {
      "type": "json_schema",
      "json_schema": {
        "name": "user_profile",
        "schema": {
          "type": "object",
          "required": ["name", "email", "age"],
          "properties": {
            "name": {"type": "string"},
            "email": {"type": "string"},
            "age": {"type": "number"}
          }
        }
      }
    }
  }'
```

**What happens:**
1. Request forwarded to Ollama (with `default` values stripped for compatibility)
2. LLM returns: `Sure! Here's a profile: {"name": "Alice", "email": "alice@example.com"`
3. Proxy heals it using schema defaults: `{"name": "Alice", "email": "alice@example.com", "age": null}`
4. You get valid, complete JSON ✅

### Option 2: Library Usage

Use `StreamHealer` directly in your code:

```typescript
import { StreamHealer } from 'openai-json-stream-healer';

const schema = {
  type: 'object',
  required: ['name', 'email', 'age']
};

const healer = new StreamHealer(schema);

// Process chunks as they arrive
const chunk1 = healer.process('Here is the data: {"name": "Alice"');
const chunk2 = healer.process(', "email": "alice@example.com"');

// Finish stream and get closure + missing fields
const closure = healer.finish();
// Returns: ,"age":null}

const completeJSON = chunk1 + chunk2 + closure;
console.log(JSON.parse(completeJSON));
// { name: "Alice", email: "alice@example.com", age: null }
```

## ⚙️ Configuration

Configure the proxy via environment variables:

| Variable            | Default                     | Description                                |
| ------------------- | --------------------------- | ------------------------------------------ |
| `UPSTREAM_BASE_URL` | `http://localhost:11434/v1` | Upstream LLM API endpoint                  |
| `UPSTREAM_API_KEY`  | _(empty)_                   | API key for upstream (optional for Ollama) |
| `PORT`              | `1143`                      | Port for the proxy server                  |
| `DEFAULT_MODEL`     | `gemma2:2b`                 | Default model if not specified in request  |

**Example with OpenAI:**

```bash
UPSTREAM_BASE_URL=https://api.openai.com/v1 \
UPSTREAM_API_KEY=sk-your-key-here \
PORT=8080 \
DEFAULT_MODEL=gpt-4 \
bun run src/index.ts
```

## 🔬 How It Works

### 1. Preamble Stripping

Removes conversational fluff before JSON:

```diff
- "Sure! Here's the JSON you requested:\n\n{\"data\": \"value\"}"
+ "{\"data\": \"value\"}"
```

### 2. Auto-Closing Structures

Fixes incomplete JSON:

```diff
- {"users": [{"name": "Alice"}, {"name": "Bob"
+ {"users": [{"name": "Alice"}, {"name": "Bob"}]}
```

### 3. Schema Injection (with Defaults)

Adds missing required fields using the provided `default` value, or `null` if none specified:

```typescript
// Schema requires: ["id", "status"]
// "status" has default: "active"
// LLM returns: {"id": 1
// Healed output: {"id": 1, "status": "active"}
```

### 4. Streaming Support

Works with Server-Sent Events (SSE):

```
data: {"choices":[{"delta":{"content":"{"}}]}
data: {"choices":[{"delta":{"content":"\"name\":"}}]}
data: {"choices":[{"delta":{"content":"\"Alice\""}}]}
data: [DONE]

↓ Healed ↓

data: {"choices":[{"delta":{"content":"{"}}]}
data: {"choices":[{"delta":{"content":"\"name\":"}}]}
data: {"choices":[{"delta":{"content":"\"Alice\""}}]}
data: {"choices":[{"delta":{"content":"}"}}]}  ← Auto-added
data: [DONE]
```

## 📚 API Reference

### `StreamHealer`

The core healing engine.

```typescript
class StreamHealer {
  constructor(schema?: JsonSchema)
  
  // Process a chunk of streaming data
  process(chunk: string): string
  
  // Finish the stream and get closing chars + schema injection
  finish(): string
}
```

**Example:**

```typescript
const healer = new StreamHealer({
  type: 'object',
  required: ['id', 'value']
});

healer.process('{"id": 1');  // Returns: {"id": 1
healer.finish();              // Returns: ,"value":null}
```

### `createProxy()`

Creates and starts the proxy server.

```typescript
function createProxy(): Server
```

**Example:**

```typescript
import { createProxy } from 'stream-healer';

const server = createProxy();
console.log(`Proxy running on port ${server.port}`);
```

### `JsonSchema`

Minimal JSON Schema interface for validation:

```typescript
interface JsonSchema {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  default?: unknown;
  $ref?: string;
  definitions?: Record<string, JsonSchema>;
  $defs?: Record<string, JsonSchema>;
  components?: {
    schemas?: Record<string, JsonSchema>;
  };
}
```

- [x] Full `$ref` Resolution: Supports generic local references (e.g., `#/definitions/MyType`).
- [x] Schema Defaults: Automatically applies `default` values from referenced schemas.

### Example with `$ref`

```typescript
const schema = {
  type: 'object',
  required: ['user'],
  definitions: {
    Person: {
      type: 'object',
      required: ['name', 'status'],
      properties: {
        name: { type: 'string' },
        status: { type: 'string', default: 'active' }
      }
    }
  },
  properties: {
    user: { $ref: '#/definitions/Person' }
  }
};

const healer = new StreamHealer(schema);
healer.process('{"user": { "name": "Alice"');
// Healer resolves "Person" ref, sees "status" is required, and injects default
console.log(healer.finish()); // Output: ,"status":"active"}}
```

## 🧪 Testing

Run the comprehensive test suite:

```bash
bun test
```

**Coverage:**
- ✅ 27 unit tests for `StreamHealer`
- ✅ 5 integration tests for proxy server
- ✅ 49 assertions total
- ✅ 100% pass rate

**Test categories:**
- Preamble stripping (4 tests)
- Auto-closing structures (6 tests)
- Schema injection (5 tests)
- Complex scenarios (7 tests)
- Edge cases (4 tests)
- Proxy integration (5 tests)
- Reference resolution (5 tests)

## 🎯 Use Cases

### 1. Structured Data Extraction

```typescript
// Extract structured data from LLM responses
const schema = {
  type: 'object',
  required: ['title', 'summary', 'tags'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } }
  }
};

const healer = new StreamHealer(schema);
// Even if LLM stops early, you get valid JSON with null placeholders
```

### 2. API Gateway

```bash
# Put stream-healer in front of Ollama
# All your apps get reliable JSON without changes
UPSTREAM_BASE_URL=http://localhost:11434/v1 \
bun run src/index.ts
```

### 3. Development & Testing

```typescript
// Mock broken LLM responses in tests
const healer = new StreamHealer();
const broken = '{"test": "data"';  // Simulate truncation
const fixed = healer.process(broken) + healer.finish();
assert(JSON.parse(fixed));  // ✅ Valid JSON
```

## 🏗️ Architecture

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ POST /v1/chat/completions
       ▼
┌─────────────────────────────────┐
│    Stream Healer Proxy :1143    │
│  ┌───────────────────────────┐  │
│  │  1. Extract schema        │  │
│  │  2. Forward to upstream   │  │
│  │  3. Heal response stream  │  │
│  │  4. Inject missing fields │  │
│  └───────────────────────────┘  │
└──────┬──────────────────────────┘
       │ Forward request
       ▼
┌─────────────────┐
│ Ollama :11434   │
│ (or OpenAI API) │
└─────────────────┘
```

## 🔧 Advanced Usage

### Custom Upstream

```bash
# Use with any OpenAI-compatible API
UPSTREAM_BASE_URL=https://api.anthropic.com/v1 \
UPSTREAM_API_KEY=sk-ant-... \
bun run src/index.ts
```

### Programmatic Proxy

```typescript
import { createProxy } from 'stream-healer';

// Set env vars programmatically
process.env.PORT = '3000';
process.env.UPSTREAM_BASE_URL = 'http://my-llm:8080/v1';

const server = createProxy();
console.log(`Healing proxy ready on :${server.port}`);
```

### Nested Schema Healing

```typescript
const schema = {
  type: 'object',
  required: ['user'],
  properties: {
    user: {
      type: 'object',
      required: ['name', 'email'],
      properties: {
        name: { type: 'string' },
        email: { type: 'string' }
      }
    }
  }
};

const healer = new StreamHealer(schema);
healer.process('{"user": {"name": "Alice"');
healer.finish();  // Closes nested structures and injects email
```

## 🐛 Limitations

- **$ref Resolution**: Supports standard local references (`#/definitions/...`, `#/components/...`). External file references are not supported.
- **Nested Schema Tracking**: Schema injection works best at the root level
- **Primitive Validation**: No type coercion (e.g., `"123"` → `123`)
- **Array Items**: Schema validation for array items is basic

These are intentional trade-offs for simplicity and performance. PRs welcome!

## 🤝 Contributing

```bash
# Clone and install
git clone https://github.com/yourusername/stream-healer.git
cd stream-healer
bun install

# Run tests
bun test

# Start proxy
bun run src/index.ts
```

## 📄 License

MIT

## 🙏 Acknowledgments

Built with:
- [Bun](https://bun.sh) - Fast all-in-one JavaScript runtime
- TypeScript strict mode for type safety
- Inspired by the challenges of real-world LLM JSON generation

---

**Made with ❤️ for developers tired of broken LLM JSON**
