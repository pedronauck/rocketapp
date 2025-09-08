# AGENTS.md

Authoritative guide for LLM agents working in this repo. It summarizes project context and points to the detailed Cursor rule files under `.cursor/rules`. Follow this as the baseline behavior when proposing, editing, or generating code.

## Project Context

- Runtime/PM: Bun (single lockfile at repo root)
- Monorepo orchestration: Turborepo (`turbo.json`)
- Workspaces: currently `backend` only (Hono + Bun). `frontend` exists but is not listed in root workspaces yet.
- Frontend: React + Vite + TanStack React Query + shadcn UI

## Primary Rules (Cursor)

Use these rule files as the source of truth for decisions in their scope:

- `.cursor/rules/bunjs.mdc` — Bun usage, APIs, testing, bundling
- `.cursor/rules/bun-workspace.mdc` — Bun monorepo + Turbo pipelines and scripts
- `.cursor/rules/hono.mdc` — Hono API conventions, routing, CORS, error handling, Bun.serve, tests
- `.cursor/rules/react-query.mdc` — Query keys, fetcher pattern, mutations, cache invalidation, error UX
- `.cursor/rules/shadcn.mdc` — Design-token usage mandate, accessibility, customization practices

When guidance conflicts, prefer the most specific rule for the task (e.g., API behavior → `hono.mdc`).

## Agent Operating Principles

- Precision first: make minimal, focused changes aligned with existing patterns; avoid unrelated edits.
- Prefer Bun-native tooling (install, test) and keep scripts consistent with each package’s `package.json`.
- Respect formatting and existing configs (Prettier, TS). Do not add new global tooling without request.
- Validate inputs (Zod in backend) and normalize errors per API rules.
- For UI, always use shadcn design tokens (`bg-background`, `text-foreground`, etc.), not hard-coded colors.
- Communicate clearly: propose changes, reference files/lines, and explain impacts briefly.

## Monorepo & Scripts

- Root scripts (Turbo): `dev`, `build`, `lint`, `format`, `format:check`, `test`.
- Install at root with `bun install` (use `--frozen-lockfile` in CI). Commit `bun.lock`.
- Turbo caching: see `turbo.json` for `outputs` and dependencies.
- Note: root `workspaces` currently includes `backend` only. If adding `frontend` to workspaces, update root `package.json` and ensure scripts conform to the common contract.

## Backend (Hono + Bun)

- Handlers are small and typed; return explicit status codes with JSON bodies only.
- Standard error shape: `{ error: string, message: string }`; don’t leak stack traces in responses.
- Register a single `app.onError` and optional `app.notFound` with normalized bodies.
- Use `hono/cors` with explicit origins; enable `credentials` only if needed.
- Keep server wiring minimal: `Bun.serve({ fetch: app.fetch, port: PORT })`.
- Prefer request-level tests via Bun’s test runner against `app.fetch`.

See `.cursor/rules/hono.mdc` for code examples and detailed policies.

## Frontend (React Query + shadcn)

- React Query defaults: `retry: 1`, `staleTime: 30_000` at client init.
- Centralize query keys; use array keys (e.g., `['products', id]`) and avoid string concatenation.
- Use a single JSON fetcher that throws on non-2xx with normalized messages.
- Mutations must either invalidate related keys or optimistically update cache with rollback.
- UI: use shadcn tokens for theme compatibility; keep Radix accessibility attributes intact.

See `.cursor/rules/react-query.mdc` and `.cursor/rules/shadcn.mdc` for patterns and examples.

## Authoring New or Updating Rules

- Place new rules under `.cursor/rules/*.mdc` with frontmatter:
  - `globs`: target files (e.g., `backend/**/*.ts`)
  - `alwaysApply`: keep `false` unless the rule must always be active
- Keep rules task-focused (API, data fetching, workspace) and include short examples.
- Reference existing rules to avoid duplication; link to specific responsibilities instead of restating.

## Safety & Review

- Prefer non-destructive changes; avoid mass renames/refactors unless requested.
- Call out follow-up items (e.g., adding `frontend` to workspaces) separately from required changes.
- For ambiguous tasks, ask for clarification and propose a small plan before editing.

---

This file is the baseline for LLM apps that support an AGENTS.md standard. Tools should ingest it along with the referenced Cursor rules for consistent behavior across the repo.

