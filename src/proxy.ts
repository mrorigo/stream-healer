import { StreamHealer, type JsonSchema } from './healer.ts';

const UPSTREAM_BASE_URL = process.env['UPSTREAM_BASE_URL'] || 'http://localhost:11434/v1';
const UPSTREAM_API_KEY = process.env['UPSTREAM_API_KEY'] || '';
const PORT = parseInt(process.env['PORT'] || '1143', 10);
const DEFAULT_MODEL = process.env['DEFAULT_MODEL'] || 'gemma3:4b';

interface ChatCompletionRequest {
    model?: string;
    messages: Array<{ role: string; content: string }>;
    stream?: boolean;
    response_format?: {
        type: string;
        json_schema?: {
            name: string;
            schema: JsonSchema;
            strict?: boolean;
        };
    };
    [key: string]: unknown;
}

interface ChatCompletionChunk {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: Array<{
        index: number;
        delta: {
            role?: string;
            content?: string;
        };
        finish_reason: string | null;
    }>;
}

/**
 * Creates an OpenAI-compatible proxy server that heals broken JSON streams.
 */
export function createProxy() {
    return Bun.serve({
        port: PORT,
        async fetch(req) {
            const url = new URL(req.url);

            // Only intercept /v1/chat/completions
            if (url.pathname !== '/v1/chat/completions' || req.method !== 'POST') {
                return new Response('Not Found', { status: 404 });
            }

            try {
                const body = await req.json() as ChatCompletionRequest;

                // Extract schema if present
                const schema = body.response_format?.type === 'json_schema'
                    ? body.response_format.json_schema?.schema
                    : undefined;

                // Strip 'default' from schema for upstream if it exists
                if (body.response_format?.json_schema?.schema) {
                    body.response_format.json_schema.schema = stripDefaults(
                        JSON.parse(JSON.stringify(body.response_format.json_schema.schema))
                    );
                }

                // Set default model if not specified
                if (!body.model) {
                    body.model = DEFAULT_MODEL;
                }

                // Forward request to upstream
                const upstreamUrl = `${UPSTREAM_BASE_URL}/chat/completions`;
                const headers: Record<string, string> = {
                    'Content-Type': 'application/json',
                };

                if (UPSTREAM_API_KEY) {
                    headers['Authorization'] = `Bearer ${UPSTREAM_API_KEY}`;
                }

                const upstreamResponse = await fetch(upstreamUrl, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(body),
                });

                if (!upstreamResponse.ok) {
                    return new Response(await upstreamResponse.text(), {
                        status: upstreamResponse.status,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }

                // Handle streaming responses
                if (body.stream) {
                    const healer = new StreamHealer(schema);
                    const encoder = new TextEncoder();
                    const decoder = new TextDecoder();

                    const stream = new ReadableStream({
                        async start(controller) {
                            try {
                                const reader = upstreamResponse.body?.getReader();
                                if (!reader) {
                                    controller.close();
                                    return;
                                }

                                let buffer = '';

                                while (true) {
                                    const { done, value } = await reader.read();

                                    if (done) {
                                        // Send final healing closure
                                        const closure = healer.finish();
                                        if (closure) {
                                            // We need to wrap the closure in a proper SSE chunk
                                            // Extract the last chunk to get the structure
                                            const finalChunk = `data: {"choices":[{"delta":{"content":"${closure.replace(/"/g, '\\"')}"}}]}\n\n`;
                                            controller.enqueue(encoder.encode(finalChunk));
                                        }
                                        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                                        controller.close();
                                        break;
                                    }

                                    buffer += decoder.decode(value, { stream: true });
                                    const lines = buffer.split('\n');
                                    buffer = lines.pop() || '';

                                    for (const line of lines) {
                                        if (line.startsWith('data: ')) {
                                            const data = line.slice(6);

                                            if (data === '[DONE]') {
                                                continue; // We'll send our own [DONE] after healing
                                            }

                                            try {
                                                const chunk = JSON.parse(data) as ChatCompletionChunk;
                                                const content = chunk.choices[0]?.delta?.content;

                                                if (content) {
                                                    // Heal the content
                                                    const healed = healer.process(content);

                                                    // Send healed chunk
                                                    if (healed && chunk.choices[0]) {
                                                        chunk.choices[0].delta.content = healed;
                                                        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                                                    }
                                                } else {
                                                    // Pass through non-content chunks
                                                    controller.enqueue(encoder.encode(`${line}\n`));
                                                }
                                            } catch (e) {
                                                // If not valid JSON, pass through
                                                controller.enqueue(encoder.encode(`${line}\n`));
                                            }
                                        } else if (line.trim()) {
                                            // Pass through non-data lines
                                            controller.enqueue(encoder.encode(`${line}\n`));
                                        }
                                    }
                                }
                            } catch (error) {
                                console.error('Stream error:', error);
                                controller.error(error);
                            }
                        },
                    });

                    return new Response(stream, {
                        headers: {
                            'Content-Type': 'text/event-stream',
                            'Cache-Control': 'no-cache',
                            'Connection': 'keep-alive',
                        },
                    });
                }

                // Handle non-streaming responses
                const responseData = await upstreamResponse.json() as {
                    choices?: Array<{ message?: { content?: string } }>;
                    [key: string]: unknown;
                };

                if (schema && responseData.choices?.[0]?.message?.content) {
                    const healer = new StreamHealer(schema);
                    const content = responseData.choices[0].message.content;
                    const healed = healer.process(content) + healer.finish();
                    responseData.choices[0].message.content = healed;
                }

                return new Response(JSON.stringify(responseData), {
                    headers: { 'Content-Type': 'application/json' },
                });

            } catch (error) {
                console.error('Proxy error:', error);
                return new Response(JSON.stringify({
                    error: {
                        message: error instanceof Error ? error.message : 'Internal server error'
                    }
                }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                });
            }
        },
    });
}

/**
 * Recursively removes 'default' keys from a JSON schema object.
 */
function stripDefaults(schema: any): any {
    if (typeof schema !== 'object' || schema === null) {
        return schema;
    }

    if (Array.isArray(schema)) {
        return schema.map(stripDefaults);
    }

    const newSchema = { ...schema };
    delete newSchema.default;

    for (const key in newSchema) {
        newSchema[key] = stripDefaults(newSchema[key]);
    }

    return newSchema;
}

// Start server if run directly
if (import.meta.main) {
    const server = createProxy();
    console.log(`🏥 Stream Healer Proxy running on http://localhost:${server.port}`);
    console.log(`📡 Forwarding to: ${UPSTREAM_BASE_URL}`);
    console.log(`🤖 Default model: ${DEFAULT_MODEL}`);
}
