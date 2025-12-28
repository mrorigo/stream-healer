import { describe, expect, test, beforeAll, afterAll, mob } from "bun:test";
import { createProxy } from "../src/proxy.ts";

const PORT = 1144; // Use different port for this test suite
process.env.PORT = PORT.toString();

// Mock upstream server
const UPSTREAM_PORT = 11444;
process.env.UPSTREAM_BASE_URL = `http://localhost:${UPSTREAM_PORT}/v1`;

const upstreamServer = Bun.serve({
    port: UPSTREAM_PORT,
    async fetch(req) {
        if (req.url.endsWith("/v1/chat/completions")) {
            const body = await req.json();

            // Allow test to specify what to return via a header or just mirror logic
            // For simplicity, we return a fixed broken JSON string
            const brokenJson = '{"data": "incomplete';

            // Return request info to verify what the proxy did (e.g. stripped schema)
            const response = {
                id: "test-id",
                object: "chat.completion",
                created: 1234567890,
                model: body.model,
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: brokenJson
                    },
                    finish_reason: "length"
                }],
                received_response_format: body.response_format
            };
            return Response.json(response);
        }
        return new Response("Not Found", { status: 404 });
    }
});

describe('Proxy Conditional Healing', () => {
    let proxyServer: any;

    beforeAll(async () => {
        const upstreamBase = `http://localhost:${UPSTREAM_PORT}/v1`;
        proxyServer = createProxy(PORT, upstreamBase);
        // Give the server a moment to bind
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterAll(() => {
        proxyServer.stop();
        upstreamServer.stop();
    });

    test('should NOT heal request without response_format', async () => {
        const res = await fetch(`http://localhost:${PORT}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'test-model',
                messages: [{ role: 'user', content: 'test' }]
            })
        });

        const data = await res.json();
        console.log('Response data:', JSON.stringify(data, null, 2));
        const content = data.choices[0].message.content;

        // Should be exactly what upstream returned (broken JSON), NOT healed
        expect(content).toBe('{"data": "incomplete');
    });

    test('should heal request with response_format type "json_object"', async () => {
        const res = await fetch(`http://localhost:${PORT}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'test-model',
                messages: [{ role: 'user', content: 'test' }],
                response_format: { type: 'json_object' }
            })
        });

        const data = await res.json();
        const content = data.choices[0].message.content;

        // Should be healed (auto-closed)
        expect(content).toBe('{"data": "incomplete"}');
    });

    test('should heal request with response_format type "json_schema"', async () => {
        const res = await fetch(`http://localhost:${PORT}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'test-model',
                messages: [{ role: 'user', content: 'test' }],
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'test',
                        schema: {
                            type: 'object',
                            required: ['data'],
                            properties: { data: { type: 'string' } }
                        }
                    }
                }
            })
        });

        const data = await res.json();
        const content = data.choices[0].message.content;

        // Should be healed
        expect(content).toBe('{"data": "incomplete"}');
    });

});
