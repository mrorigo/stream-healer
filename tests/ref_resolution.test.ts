import { describe, expect, test } from "bun:test";
import { StreamHealer, type JsonSchema } from "../src/healer.ts";

describe('StreamHealer Ref Resolution', () => {

    test('should resolve reference to definition', () => {
        const schema: JsonSchema = {
            type: 'object',
            required: ['user'],
            properties: {
                user: { $ref: '#/definitions/User' }
            },
            definitions: {
                User: {
                    type: 'object',
                    required: ['name', 'id'],
                    properties: {
                        name: { type: 'string' },
                        id: { type: 'number' }
                    }
                }
            }
        };

        const healer = new StreamHealer(schema);
        // User object started but not strictly closed or filled
        healer.process('{"user": {"name": "Alice"');

        // Should find "id" from the User definition
        expect(healer.finish()).toBe(',"id":null}}');
    });

    test('should resolve nested references', () => {
        const schema: JsonSchema = {
            type: 'object',
            required: ['wrapper'],
            definitions: {
                Profile: {
                    type: 'object',
                    required: ['email'],
                    properties: { email: { type: 'string' } }
                },
                User: {
                    type: 'object',
                    required: ['profile'],
                    properties: {
                        profile: { $ref: '#/definitions/Profile' }
                    }
                }
            },
            properties: {
                wrapper: { $ref: '#/definitions/User' }
            }
        };

        const healer = new StreamHealer(schema);
        healer.process('{"wrapper": {"profile": {');

        // Should resolve wrapper -> User -> profile -> Profile -> email
        expect(healer.finish()).toBe('"email":null}}}');
    });

    test('should resolve references in array items', () => {
        const schema: JsonSchema = {
            type: 'object',
            required: ['users'],
            definitions: {
                User: {
                    type: 'object',
                    required: ['id'],
                    properties: { id: { type: 'number' } }
                }
            },
            properties: {
                users: {
                    type: 'array',
                    items: { $ref: '#/definitions/User' }
                }
            }
        };

        const healer = new StreamHealer(schema);
        // Array started, first item open
        healer.process('{"users": [{');

        expect(healer.finish()).toBe('"id":null}]}');
    });

    test('should handle missing references gracefully', () => {
        const schema: JsonSchema = {
            type: 'object',
            required: ['data'],
            properties: {
                data: { $ref: '#/definitions/Missing' }
            }
        };

        const healer = new StreamHealer(schema);
        healer.process('{"data": {');

        // Should just close normally without healing schema fields
        // because it couldn't resolve the type.
        expect(healer.finish()).toBe('}}');
    });

    test('should resolve references with defaults', () => {
        const schema: JsonSchema = {
            type: 'object',
            required: ['config'],
            definitions: {
                Config: {
                    type: 'object',
                    required: ['mode'],
                    properties: {
                        mode: { type: 'string', default: 'dark' }
                    }
                }
            },
            properties: {
                config: { $ref: '#/definitions/Config' }
            }
        };

        const healer = new StreamHealer(schema);
        healer.process('{"config": {');

        // Should find implicit "mode" from reference and use default
        expect(healer.finish()).toBe('"mode":"dark"}}');
    });

});
