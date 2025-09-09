# Project Guidelines

## Project Planning

When working on larger features or multi-step implementations, use Product Requirements Documents (PRDs) to plan and track progress:

### PRD Best Practices

1. **Location**: Store PRDs in the `/tasks/` folder with descriptive names (e.g., `prd-skeleton-loaders.md`) and gh issues when neccessary

2. **Structure**: Include these sections:
   - **Project Overview**: Objective, background, success metrics
   - **Current State Analysis**: What exists, what's broken, what needs improvement
   - **Implementation Plan**: Break work into phases with clear priorities
   - **Technical Guidelines**: Architecture decisions, patterns to follow
   - **Acceptance Criteria**: Specific, measurable outcomes for each phase

3. **Phase-Based Implementation**:
   - Break large features into 2-4 phases based on priority and dependencies
   - Each phase should be completable in 1-3 days
   - Mark phases as completed with ✅ as work progresses
   - Use clear priority levels: HIGH, MEDIUM, LOW

4. **Progress Tracking**:
   - Update the PRD as you complete tasks, marking items with ✅
   - Add implementation summaries after each phase
   - Include test coverage and impact metrics
   - Document architectural decisions and patterns established

5. **Examples**:
   - See `/tasks/prd-skeleton-loaders.md` for a well-structured PRD example
   - Notice how it breaks skeleton implementation into logical phases
   - Each phase has clear deliverables and acceptance criteria

### When to Create a PRD

Create a PRD when:
- The feature spans multiple components or files
- Implementation will take more than 1-2 days
- The work involves architectural decisions
- You need to coordinate multiple related changes
- The user requests comprehensive planning before implementation

## Bun Workspace + Turbo Monorepo

### Core Philosophy
**Single lockfile, shared scripts, fast pipelines**

- Manage dependencies at the repo root with Bun; commit `bun.lock`
- Use Turbo for orchestration; keep package scripts consistent
- Keep builds incremental; define clear `outputs` for caching
- Prefer simple per-package scripts; compose with Turbo at the root

### Structure
**Recommended layout**

- Root: `package.json`, `bun.lock`, `turbo.json`, tooling configs
- Workspaces: `backend/`, `frontend/` (name each package in its `package.json`)
- Add both to root `workspaces` for installation and linking

### Installation
**Fast, reproducible installs**

- Always run `bun install` at the repo root
- Never run package managers inside workspaces directly
- Use `--frozen-lockfile` in CI for deterministic installs

### Scripts per Package
**Keep a common script contract**

- `dev`: start local dev server (watch)
- `build`: produce distributable output (`dist/**` or framework default)
- `start`: run the built app (if applicable)
- `lint`, `format`, `format:check`, `test`: tooling hooks

### Turbo Pipeline
**Cache what matters; wire deps properly**

- `build` depends on parent `^build`; cache `dist/**` (and framework outputs)
- `dev` is non-cached and `persistent`
- `test` depends on `^build`; cache coverage artifacts

## Bun.js Best Practices

### Core Philosophy
**All-in-One Development Philosophy:**

- Bun is an all-in-one toolkit: runtime, bundler, test runner, package manager
- Prioritize Bun's native APIs over Node.js equivalents for performance
- TypeScript and JSX work out of the box - no configuration needed
- Embrace the speed advantages in all aspects of development

### Runtime Optimization
**High-Performance Runtime Usage:**

- Use Bun's native APIs for file operations
- Leverage built-in HTTP server for maximum performance
- Use Bun.spawn for subprocess management
- Take advantage of native JSON parsing

### Testing with Bun
**Comprehensive Testing Approach:**

- Use Bun's built-in test runner for speed
- Write tests in TypeScript without configuration
- Use built-in mocking capabilities
- Leverage fast test execution

### Environment Configuration
**Robust Environment Setup:**

- Use .env files with automatic loading
- Validate environment variables at startup
- Use different configs per environment
- Implement type-safe environment access

### Performance Optimization
**Maximum Performance Strategies:**

- Use Bun's fast startup for development
- Leverage hot reloading for instant feedback
- Use native APIs instead of polyfills
- Optimize bundle splitting for production

## Hono + Bun API Rules (backend/**/*.ts)

### Core Philosophy
**Lean, typed handlers with consistent responses**

- Prefer small, pure handlers; keep side effects in services
- Use `Context` types and explicit status codes for every response
- Always return JSON with a consistent error shape: `{ error, message }`
- Centralize error handling via `app.onError` and avoid `throw`ing raw errors in handlers
- Validate all input (query, params, body) with Zod before use
- Keep Bun-specific wiring minimal: `Bun.serve({ fetch: app.fetch })`

### Routing Conventions
**Paths, methods, and status codes**

- Use RESTful resource paths; reserve `/health` for uptime checks
- Use plural nouns for collections (`/products`) and ids for single resources (`/products/:id`)
- Respond with 201 for creations, 204 for deletions with no body
- Namespacing: prefer `/api/*` when exposing to a UI; keep `/health` top-level

### Middleware
**CORS, logging, and security**

- Use `hono/cors` and configure explicit origins; set `credentials: true` when needed
- Add lightweight request logging in dev (method, path, status, timing)
- Consider `hono/pretty-json` in dev only; never in production

### Error Handling
**Single `onError` with normalized body**

- Register one `ErrorHandler` via `app.onError`
- Hide stack traces from responses; log them to stderr
- Return `{ error: 'InternalError', message }` with 500
- For 404, optionally set `app.notFound` to return `{ error: 'NotFound' }`

### Bun Server Wiring
**Production-ready `Bun.serve` defaults**

- Read `PORT` from env; default to `3005` for local dev
- Use `fetch: app.fetch` and do not wrap with extra routers
- Keep `Bun.serve` as the only server entry in the backend package

### Testing (bun:test)
**Test handlers via Fetch**

- Prefer request-level tests against `app.fetch`
- Use `bun:test` with `describe/it` and `mock` when needed
- Assert status codes and response JSON shape

## React Query (TanStack) Guidelines (frontend/src/**/*.ts,frontend/src/**/*.tsx)

### Core Philosophy
**Treat server-state as derived and cacheable**

- Co-locate queries with components; keep fetchers stateless and reusable
- Use stable, structured query keys; avoid inline string concatenation
- Prefer longer `staleTime` for data that rarely changes; tune `retry`
- Use mutations for writes; invalidate or update cache deterministically
- Handle errors at the boundary (toasts, error components) not deep in fetchers

### Client Setup
**Default options match project standards**

- `retry: 1` and `staleTime: 30_000` (30s) by default
- Wrap app with `QueryClientProvider`; keep a singleton `QueryClient`
- Optionally add Devtools in dev

### Query Keys
**Centralize and type keys**

- Define a `queryKeys` helper to ensure stability and avoid typos
- Keys are arrays: `['products', id]`, `['orders', { page, q }]`

### Fetcher Utility
**Single JSON fetcher with error normalization**

- Throw on non-2xx; include status code and body when possible
- Do not show toasts inside fetchers; let callers decide

### Queries
**Colocate queries, select minimal data, cache smartly**

- Use typed return values; narrow with `select` when possible
- Derive `enabled` from required params to avoid pointless requests
- Prefer pagination params in the key to isolate caches

### Mutations
**Invalidate or update related caches**

- After create/update/delete, either:
  - invalidate affected keys (`queryClient.invalidateQueries({ queryKey })`), or
  - optimistically update via `setQueryData` and rollback on error
- Keep mutation functions small and focused on the network call

### Error UX
**Clear surfaces for failures**

- Prefer component-level error UIs or toasts; do not swallow errors
- Consider an app-level error boundary for uncaught errors

## Shadcn UI Best Practices

### CRITICAL: Always Use Design System Tokens for Theme Switching

To ensure the theme switching functionality works correctly across light and dark modes, you MUST always use design system tokens instead of explicit color values:

✅ **Always use:** `bg-background`, `text-foreground`, `border-border`, `bg-primary`, `text-primary-foreground`
❌ **Never use:** `bg-white`, `text-black`, `border-gray-200`, `bg-blue-500`, `text-green-400`

**Why this matters:**

- Design tokens automatically adapt to the current theme (light/dark)
- Explicit values break theme switching and cause accessibility issues
- Design tokens ensure consistent brand colors across all themes

**Required tokens for common use cases:**

- Backgrounds: `bg-background`, `bg-card`, `bg-muted`, `bg-popover`
- Text: `text-foreground`, `text-muted-foreground`, `text-card-foreground`
- Borders: `border-border`, `border-input`, `border-ring`
- Actions: `bg-primary text-primary-foreground`, `bg-secondary text-secondary-foreground`
- States: `bg-destructive text-destructive-foreground`, `bg-accent text-accent-foreground`

### Core Philosophy
**Shadcn UI Development Philosophy:**

- Shadcn is copy-paste, not a dependency - you own the code
- Components are meant to be customized for your needs
- Built on Radix UI primitives for accessibility
- Styled with Tailwind CSS for flexibility

### Component Customization
**Customization Guidelines:**

- Directly edit component files after installation
- Don't hesitate to modify structure, styles, or behavior
- Keep accessibility attributes from Radix UI
- Add your own props and variants as needed
- Use Tailwind Variants for component styling

### Accessibility Best Practices
**Critical Accessibility Requirements:**

- Never remove Radix UI's accessibility attributes
- Test all components with keyboard navigation
- Ensure proper focus management
- Use semantic HTML elements
- Add proper ARIA labels where needed

### Theming Strategy
**Comprehensive Theme Management:**

- Use CSS variables for all color values
- Extend theme in globals.css
- Create semantic color names
- Support dark mode from the start

### Form Handling with @tanstack/react-form
**Form Management Best Practices:**

- Use the Form components for consistent styling
- Integrate with zod for validation
- Handle errors gracefully
- Provide clear feedback

### Animation Integration
**Animation Strategy:**

- Use Framer Motion for complex animations
- Keep Radix's built-in animations for dialogs/tooltips
- Ensure animations respect prefers-reduced-motion
- Add subtle micro-interactions

### Performance Considerations
**Critical Performance Patterns:**

- Lazy load heavy components (Sheet, Dialog)
- Use React.memo for expensive list items
- Implement virtualization for long lists
- Optimize bundle size by importing only used components

### Testing Components
**Comprehensive Testing Strategy:**

- Test user interactions, not implementation
- Use React Testing Library
- Mock complex dependencies
- Test accessibility requirements

## General Guidelines

### Essential Project Rules

1. **Use Bun's native APIs for maximum performance**
2. **Leverage built-in TypeScript and JSX support**
3. **Use bun test for fast testing workflows**
4. **Configure bunfig.toml for project settings**
5. **Use workspaces for monorepo management**
6. **Implement type-safe environment configuration**
7. **Use hot reloading for development efficiency**
8. **Optimize builds with proper target configuration**
9. **Secure applications with proper error handling**
10. **Deploy with official Docker images and monitoring**

### TypeScript Guidelines

- Never use `any` in TypeScript
- Implement proper type safety throughout the application
- Use strict mode for TypeScript configuration

### Security Considerations

- Never commit env variables!
- Validate all environment variables
- Use secure defaults for server configuration
- Implement proper error handling
- Follow least privilege principles

### Git and PR Guidelines

- PR descriptions 200 words or less
- Always provide PR descriptions in markdown with headers
- Create GitHub issues with existing labels only
- Use supababase MCP to apply new migrations
- Provide PR descriptions in markdown always

### Code Quality

- Run lint and typecheck commands before committing
- Follow existing code conventions and patterns
- Keep components focused and reusable
- Test thoroughly with proper coverage

**MANDATORY:** These patterns must be followed consistently across all applications and configurations.
