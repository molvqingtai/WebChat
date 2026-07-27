# Repository Guidelines

## Project Structure & Module Organization

- `src/app` defines the browser action surfaces and extension entrypoints; start here when wiring new UI flows.
- `src/components` stores reusable React pieces, while `src/hooks`, `src/utils`, and `src/lib` hold shared logic; co-locate feature-specific assets beside their consumer.
- `src/domain` models state with Remesh, `src/service` implements background scripts, and `src/protocol` centralizes messaging contracts between contexts.
- Keep static icons, locales, and manifest overrides in `public/`; adjust extension metadata and bundler options in `wxt.config.ts`.

## Build, Test & Development Commands

- `pnpm install` installs dependencies; use Node 22.18 or newer as declared by `package.json`.
- `pnpm test` runs the colocated Vitest suite once.
- `pnpm test:e2e:chrome` builds and exercises the production Chrome MV3 extension through the repository E2E harness.
- `pnpm build:chrome` and `pnpm build:firefox` create production builds per browser; `pnpm pack:*` zips distributables for store submission.
- `pnpm format` applies oxfmt corrections and `pnpm lint` applies oxlint safe fixes; `pnpm format:check` and `pnpm lint:check` report violations without modifying files; `pnpm check` runs the TypeScript compiler in no-emit mode for API regressions.

## Coding Style & Naming Conventions

- Follow the oxfmt defaults in `.oxfmtrc.json` (`semi: false`, `singleQuote: true`, `printWidth: 120`); never mix manual formatting with tool output.
- Use PascalCase for React components in `src/components`, camelCase for hooks/utilities, and prefix hooks with `use` (e.g., `usePeerConnection`).
- Tailwind CSS utilities power styling; prefer component-level class composition via `clsx` as configured in `.oxfmtrc.json` (`sortTailwindcss`).
- Run `pnpm format` and `pnpm lint` before committing so the working tree stays clean under the read-only check commands and husky gates.

## Testing Guidelines

- Place focused tests beside source as `<module>.test.ts` or `<module>.spec.tsx`; shared browser harness code belongs in `e2e/`.
- Treat `pnpm test`, `pnpm check`, `pnpm format:check`, and `pnpm lint:check` as separate required signals. A production build does not substitute for runtime acceptance.
- Use exact-bound production artifacts for browser verification. Chrome MV3 automation uses the repository E2E harness; Firefox MV2 and final cross-browser product checks run in the Owner's local test environment with isolated profiles and explicit process/profile cleanup.
- Do not use a WXT development session as release evidence. Record which exact and browser artifact was loaded when reporting a browser result.

## Commit & Pull Request Guidelines

- Commits must satisfy Conventional Commits (enforced by `.commitlintrc`), e.g., `feat: add room presence indicator`.
- Group logical changes by feature; avoid mixing refactors and feature work in a single commit.
- Pull requests need a concise summary, linked issue (if any), and before/after screenshots for UI updates; mention affected browsers when behavior differs.
- Ensure CI-friendly commands (`pnpm lint`, `pnpm check`, builds) pass locally and document any follow-up tasks in the PR description.
