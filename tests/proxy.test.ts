import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createProxy } from '../src/proxy.ts';
import type { JsonSchema } from '../src/healer.ts';

describe('Proxy Server Integration', () => {
    let proxyServer: ReturnType<typeof createProxy>;
    let mockUpstreamServer: ReturnType<typeof Bun.serve>;
    const PROXY_PORT = 1143;
    const MOCK_UPSTREAM_PORT = 11434;

    beforeAll(async () => {
        // Set environment variables for proxy
        process.env['UPSTREAM_BASE_URL'] = `http://localhost:${MOCK_UPSTREAM_PORT}/v1`;
        process.env['PORT'] = PROXY_PORT.toString();
        process.env['DEFAULT_MODEL'] = 'test-model';

        // Create mock upstream server
        mockUpstreamServer = Bun.serve({
            port: MOCK_UPSTREAM_PORT,
            async fetch(req) {
                const url = new URL(req.url);

                if (url.pathname === '/v1/chat/completions') {
                    const body = await req.json() as {
                        stream?: boolean;
                        test_scenario?: string;
                    };

                    // Non-streaming broken JSON response
                    if (!body.stream) {
                        if (body.test_scenario === 'incomplete_json') {
                            return new Response(JSON.stringify({
                                id: 'test-1',
                                object: 'chat.completion',
                                created: Date.now(),
                                model: 'test-model',
                                choices: [{
                                    index: 0,
                                    message: {
                                        role: 'assistant',
                                        content: '{"name": "Alice", "email": "alice@example.com"' // Missing closing brace
                                    },
                                    finish_reason: 'stop'
                                }]
                            }), {
                                headers: { 'Content-Type': 'application/json' }
                            });
                        }

                        // Complete JSON response
                        return new Response(JSON.stringify({
                            id: 'test-2',
                            object: 'chat.completion',
                            created: Date.now(),
                            model: 'test-model',
                            choices: [{
                                index: 0,
                                message: {
                                    role: 'assistant',
                                    content: '{"name": "Bob", "email": "bob@example.com"}'
                                },
                                finish_reason: 'stop'
                            }]
                        }), {
                            headers: { 'Content-Type': 'application/json' }
                        });
                    }

                    // Streaming broken JSON response
                    if (body.test_scenario === 'streaming_incomplete') {
                        const encoder = new TextEncoder();
                        const stream = new ReadableStream({
                            start(controller) {
                                // Send chunks with incomplete JSON
                                controller.enqueue(encoder.encode('data: {"id":"test-3","object":"chat.completion.chunk","created":' + Date.now() + ',"model":"test-model","choices":[{"index":0,"delta":{"role":"assistant","content":"{\\"users\\":"},"finish_reason":null}]}\n\n'));
                                controller.enqueue(encoder.encode('data: {"id":"test-3","object":"chat.completion.chunk","created":' + Date.now() + ',"model":"test-model","choices":[{"index":0,"delta":{"content":"["},"finish_reason":null}]}\n\n'));
                                controller.enqueue(encoder.encode('data: {"id":"test-3","object":"chat.completion.chunk","created":' + Date.now() + ',"model":"test-model","choices":[{"index":0,"delta":{"content":"{\\"name\\":\\"Alice\\"}"},"finish_reason":null}]}\n\n'));
                                controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                                controller.close();
                            }
                        });

                        return new Response(stream, {
                            headers: {
                                'Content-Type': 'text/event-stream',
                                'Cache-Control': 'no-cache'
                            }
                        });
                    }

                    return new Response('Not Found', { status: 404 });
                }

                return new Response('Not Found', { status: 404 });
            }
        });

        // Create proxy server
        proxyServer = createProxy();

        // Wait for servers to be ready
        await new Promise(resolve => setTimeout(resolve, 100));
    });

    afterAll(() => {
        mockUpstreamServer.stop();
        proxyServer.stop();
    });

    describe('Non-Streaming Responses', () => {
        test('should heal incomplete JSON in non-streaming response', async () => {
            const response = await fetch(`http://localhost:${PROXY_PORT}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'test-model',
                    messages: [{ role: 'user', content: 'test' }],
                    stream: false,
                    test_scenario: 'incomplete_json',
                    response_format: {
                        type: 'json_schema',
                        json_schema: {
                            name: 'user_profile',
                            schema: {
                                type: 'object',
                                required: ['name', 'email']
                            } as JsonSchema
                        }
                    }
                })
            });

            expect(response.ok).toBe(true);
            const data = await response.json() as {
                choices: Array<{ message: { content: string } }>;
            };

            const content = data.choices[0]?.message?.content;
            expect(content).toBeDefined();

            // Should be valid JSON now
            const parsed = JSON.parse(content!);
            expect(parsed.name).toBe('Alice');
            expect(parsed.email).toBe('alice@example.com');
        });

        test('should pass through complete JSON unchanged', async () => {
            const response = await fetch(`http://localhost:${PROXY_PORT}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'test-model',
                    messages: [{ role: 'user', content: 'test' }],
                    stream: false
                })
            });

            expect(response.ok).toBe(true);
            const data = await response.json() as {
                choices: Array<{ message: { content: string } }>;
            };

            const content = data.choices[0]?.message?.content;
            const parsed = JSON.parse(content!);
            expect(parsed.name).toBe('Bob');
            expect(parsed.email).toBe('bob@example.com');
        });
    });

    describe('Streaming Responses', () => {
        test('should heal incomplete JSON in streaming response', async () => {
            const response = await fetch(`http://localhost:${PROXY_PORT}/v1/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: 'test-model',
                    messages: [{ role: 'user', content: 'test' }],
                    stream: true,
                    test_scenario: 'streaming_incomplete',
                    response_format: {
                        type: 'json_schema',
                        json_schema: {
                            name: 'users_list',
                            schema: {
                                type: 'object',
                                required: ['users']
                            } as JsonSchema
                        }
                    }
                })
            });

            expect(response.ok).toBe(true);
            expect(response.headers.get('Content-Type')).toBe('text/event-stream');

            const reader = response.body?.getReader();
            expect(reader).toBeDefined();

            const decoder = new TextDecoder();
            let fullContent = '';
            let done = false;

            while (!done) {
                const { value, done: streamDone } = await reader!.read();
                done = streamDone;

                if (value) {
                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n');

                    for (const line of lines) {
                        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                            try {
                                const data = JSON.parse(line.slice(6));
                                const content = data.choices?.[0]?.delta?.content;
                                if (content) {
                                    fullContent += content;
                                }
                            } catch (e) {
                                // Skip invalid JSON lines
                            }
                        }
                    }
                }
            }

            // The healer should have closed the structures
            expect(fullContent).toContain('{');
            expect(fullContent).toContain('[');

            // Should be valid JSON after healing
            const parsed = JSON.parse(fullContent);
            expect(parsed.users).toBeDefined();
            expect(Array.isArray(parsed.users)).toBe(true);
        });
    });

    describe('Error Handling', () => {
        test('should return 404 for non-completions endpoints', async () => {
            const response = await fetch(`http://localhost:${PROXY_PORT}/v1/models`, {
                method: 'GET'
            });

            expect(response.status).toBe(404);
        });

        test('should return 404 for non-POST requests', async () => {
            const response = await fetch(`http://localhost:${PROXY_PORT}/v1/chat/completions`, {
                method: 'GET'
            });

            expect(response.status).toBe(404);
        });
    });
});
