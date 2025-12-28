// Library exports
export { StreamHealer, type JsonSchema, type StackFrame } from './healer.ts';

// Proxy server
export { createProxy } from './proxy.ts';

// CLI entry point
if (import.meta.main) {
    const { createProxy } = await import('./proxy.ts');
    createProxy();
}