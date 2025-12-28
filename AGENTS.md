
## Code Quality

- Use `bun lint` to check code quality.
- Use `bun test` to run tests.

## Anti-Bloat Testing Protocol

Before adding any tests, you must search the tests/ directory for existing coverage of your target functions. If overlapping assertions or similar test cases exist, you MUST justify why the new logic cannot be consolidated into an existing block (e.g., using test.each()) rather than creating a new one. Prioritize "Table-Driven Testing" to maximize coverage while minimizing the total number of test functions.

## Documentation Maintenance

**Crucial**: You must keep the documentation up-to-date as you evolve the system.

1.  **READMEs**:
    *   **Root `README.md`**: High-level overview and Quick Start. Update when major components change.
    *   **Package `README.md`** (`packages/*/README.md`): Detailed feature documentation. Update when adding new features or changing APIs.

2.  **`HANDOFF.md`**:
    *   This is the "Source of Truth" for project status.
    *   Update **Status**, **Current State**, and **Next Steps** at the end of every major task or session.
    *   Ensure "Known Issues" reflects reality.

## TypeScript Import Rules

**Use `import type` for type-only imports. Use static imports, not dynamic `import()`.**

### Automated Enforcement

Oxlint automatically enforces these rules via `bun lint`:

```bash
bun lint                           # Check violations
./node_modules/.bin/oxlint --fix  # Auto-fix violations
```

### Rules

✅ **DO**: Use strict typescript rules, no `any` types.
✅ **DO**: Use static imports, not dynamic `import()`.
✅ **DO**: Use `import type` for type-only imports.
❌ **DON'T**: Use inline `import()` type syntax (oxlint can't detect this)

See `.oxlintrc.json` for configuration.
