## Code style

Follow `READABILITY.md` when writing or changing code. In particular: never
chain ternaries. Map a closed set of values (statuses, kinds, variants) with a
lookup table typed `satisfies Record<Union, ...>`, use a `switch` when the cases
run logic, and use a small function with early returns for conditions checked in
priority order. `eslint/no-nested-ternary` fails lint.

Put code where `ARCHITECTURE.md` says it belongs, and keep its dependency
direction: routes and jobs use application ports, never database adapters.

Lint (`.oxlintrc.json`) also requires:

- One trailing `export { ... }` list per module: no inline `export const`,
  `function`, `class` or `type`, and a default export is
  `export { name as default }`.
- A `// SAFETY:` comment before every `as` assertion other than `as const`.
- A blank line before `return`, around multi-line blocks, and around any other
  multi-line statement. A `type X = typeof X…` alias may sit directly under the
  declaration it reads.
- Imports in five groups: `node:` built-ins, packages, `@node-effect/*`, `../`,
  then `./`.
- No module mocking: replace a service with `Layer.succeed` or `Layer.mock`.

Node runs the TypeScript sources directly by stripping types, so relative
imports end in `.ts` (lint rejects `.js`), type-only imports use `import type`,
and enums, namespaces, parameter properties and `<T>value` assertions are not
allowed.

`pnpm check` must pass before a change is done; `pnpm fix` formats and
lint-fixes. Never edit the migrations in `drizzle/` or the vendored
`tools/oxlint/anti-slop/`.
