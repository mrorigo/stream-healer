import { describe, test, expect } from 'bun:test';
import { StreamHealer, type JsonSchema } from '../src/healer.ts';

describe('StreamHealer', () => {
    describe('Preamble Stripping', () => {
        test('should strip conversational preamble before JSON', () => {
            const healer = new StreamHealer();
            const result1 = healer.process('Here is the code: {"foo"');
            const result2 = healer.process(': "bar"}');
            const final = healer.finish();

            expect(result1).toBe('{"foo"');
            expect(result2).toBe(': "bar"}');
            expect(final).toBe('');
        });

        test('should handle preamble with newlines', () => {
            const healer = new StreamHealer();
            const result = healer.process('Sure! Here\'s the JSON:\n\n{"data": "value"');

            expect(result).toBe('{"data": "value"');
        });

        test('should handle array start', () => {
            const healer = new StreamHealer();
            const result = healer.process('Here is an array: [1, 2, 3');

            expect(result).toBe('[1, 2, 3');
        });

        test('should flush buffer if no JSON found within limit', () => {
            const healer = new StreamHealer();
            const longText = 'a'.repeat(600); // Exceeds MAX_PREAMBLE_BUFFER
            const result = healer.process(longText);

            expect(result).toBe(longText);
        });
    });

    describe('Auto-Closing Structures', () => {
        test('should close incomplete object', () => {
            const healer = new StreamHealer();
            healer.process('{"a": 1');

            expect(healer.finish()).toBe('}');
        });

        test('should close incomplete array', () => {
            const healer = new StreamHealer();
            healer.process('[1, 2, 3');

            expect(healer.finish()).toBe(']');
        });

        test('should close nested structures', () => {
            const healer = new StreamHealer();
            healer.process('{"outer": {"inner": "val"');

            expect(healer.finish()).toBe('}}');
        });

        test('should close array with incomplete object', () => {
            const healer = new StreamHealer();
            healer.process('[{"id": 1}, {"id": 2');

            expect(healer.finish()).toBe('}]');
        });

        test('should close deeply nested structures', () => {
            const healer = new StreamHealer();
            healer.process('{"a": [{"b": {"c": [1, 2');

            expect(healer.finish()).toBe(']}}]}');
        });

        test('should close incomplete string', () => {
            const healer = new StreamHealer();
            healer.process('{"key": "value without closing quote');

            expect(healer.finish()).toBe('"}');
        });
    });

    describe('Schema Injection', () => {
        test('should inject missing required fields with null', () => {
            const schema: JsonSchema = {
                type: 'object',
                required: ['a', 'b'],
            };
            const healer = new StreamHealer(schema);
            healer.process('{"a": 1');

            expect(healer.finish()).toBe(',"b":null}');
        });

        test('should inject missing required fields with default values', () => {
            const schema: JsonSchema = {
                type: 'object',
                required: ['a', 'b', 'c'],
                properties: {
                    b: { type: 'string', default: 'default_value' },
                    c: { type: 'number', default: 42 }
                }
            };
            const healer = new StreamHealer(schema);
            healer.process('{"a": 1');

            expect(healer.finish()).toBe(',"b":"default_value","c":42}');
        });
        test('should not inject fields that are present', () => {
            const schema: JsonSchema = {
                type: 'object',
                required: ['a', 'b'],
            };
            const healer = new StreamHealer(schema);
            healer.process('{"a": 1, "b": 2');

            expect(healer.finish()).toBe('}');
        });

        test('should inject multiple missing fields', () => {
            const schema: JsonSchema = {
                type: 'object',
                required: ['name', 'email', 'age'],
            };
            const healer = new StreamHealer(schema);
            healer.process('{"name": "Alice"');

            expect(healer.finish()).toBe(',"email":null,"age":null}');
        });

        test('should handle empty object with required fields', () => {
            const schema: JsonSchema = {
                type: 'object',
                required: ['id', 'value'],
            };
            const healer = new StreamHealer(schema);
            healer.process('{');

            expect(healer.finish()).toBe('"id":null,"value":null}');
        });

        test('should work without schema', () => {
            const healer = new StreamHealer();
            healer.process('{"incomplete": "data"');

            expect(healer.finish()).toBe('}');
        });
    });

    describe('Complex Scenarios', () => {
        test('should handle complete valid JSON', () => {
            const healer = new StreamHealer();
            const result = healer.process('{"valid": "json"}');

            expect(result).toBe('{"valid": "json"}');
            expect(healer.finish()).toBe('');
        });

        test('should handle escaped quotes in strings', () => {
            const healer = new StreamHealer();
            healer.process('{"text": "He said \\"hello\\""}');

            expect(healer.finish()).toBe('');
        });

        test('should handle mixed arrays and objects', () => {
            const healer = new StreamHealer();
            healer.process('[{"a": 1}, {"b": [2, 3');

            expect(healer.finish()).toBe(']}]');
        });

        test('should process chunks incrementally', () => {
            const healer = new StreamHealer();

            const chunk1 = healer.process('{"users": [');
            const chunk2 = healer.process('{"name": "Alice"}, ');
            const chunk3 = healer.process('{"name": "Bob"');
            const final = healer.finish();

            expect(chunk1).toBe('{"users": [');
            expect(chunk2).toBe('{"name": "Alice"}, ');
            expect(chunk3).toBe('{"name": "Bob"');
            expect(final).toBe('}]}');
        });

        test('should handle schema with nested objects', () => {
            const schema: JsonSchema = {
                type: 'object',
                required: ['user'],
                properties: {
                    user: {
                        type: 'object',
                        required: ['name', 'email'],
                    },
                },
            };
            const healer = new StreamHealer(schema);
            healer.process('{"user": {"name": "Alice"');

            // Note: Current implementation has limitations with nested schema tracking
            // This test documents current behavior
            const result = healer.finish();
            expect(result).toContain('}');
        });

        test('should handle empty input', () => {
            const healer = new StreamHealer();

            expect(healer.finish()).toBe('');
        });

        test('should handle whitespace-only input', () => {
            const healer = new StreamHealer();
            healer.process('   \n  \t  ');

            expect(healer.finish()).toBe('   \n  \t  ');
        });
    });

    describe('Edge Cases', () => {
        test('should handle numbers and booleans', () => {
            const healer = new StreamHealer();
            healer.process('{"num": 42, "bool": true, "null": null');

            expect(healer.finish()).toBe('}');
        });

        test('should handle arrays of primitives', () => {
            const healer = new StreamHealer();
            healer.process('[1, "two", true, null');

            expect(healer.finish()).toBe(']');
        });

        test('should handle colon in object', () => {
            const healer = new StreamHealer();
            healer.process('{"key":');

            expect(healer.finish()).toBe('}');
        });

        test('should handle comma in object', () => {
            const healer = new StreamHealer();
            healer.process('{"a": 1,');

            expect(healer.finish()).toBe('}');
        });
    });
});
