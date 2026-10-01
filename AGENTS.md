# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot, Gemini CLI, etc.) working in this repository. Human contributors should follow these too.

> Follows the open [AGENTS.md](https://agents.md) convention. The `AGENTS.md` closest to the code being changed takes precedence. Detailed guides live in [`docs/`](docs/) — this file holds the rules.

---

## Project overview

<!-- TEMPLATE: fill this in for each project, then delete this comment. -->

- **What it is:** _One or two sentences on what the service does and who uses it._
- **Stack:** _e.g. Node 24 + TypeScript, Fastify, PostgreSQL 17 via Prisma, Vitest + Supertest._
- **Layout:**

  | Path | Contents |
  | --- | --- |
  | `src/routes/` | HTTP handlers, one file per resource |
  | `src/services/` | Business logic, no HTTP concerns |
  | `src/db/` | Schema, migrations, data access |
  | `tests/` | Integration tests, fixtures, factories |
  | `docs/` | API spec (`openapi.yaml`) and guides |

---

## Non-negotiable rules

1. **Write tests for every endpoint you create.** No endpoint is complete without automated tests covering it — REST routes, GraphQL resolvers, RPC handlers, webhooks, and server actions alike.
2. **Always validate that endpoints are working.** Passing tests are not enough — also exercise each endpoint against a running server before reporting the work as done.
3. **Never weaken tests to make them pass.** Don't delete, skip, or loosen assertions on a failing test unless the behaviour was intentionally changed — and say so explicitly.
4. **Report results honestly.** If a test fails or an endpoint couldn't be verified, say so and include the output. Never claim something works without having run it.

## Ask before you…

Stop and get explicit human approval before any of the following:

- Running migrations against any shared, staging, or production database, or deleting/overwriting data outside a local test DB
- Deploying, releasing, publishing packages, or changing DNS/infrastructure
- Force-pushing, rewriting published history, or committing directly to `main`
- Changing CI/CD pipelines, auth/permission logic, security headers, or CORS settings
- Adding, removing, or major-version-upgrading a dependency
- Making a breaking change to a public API contract

Never:

- Read, print, or modify real secrets, production credentials, or `.env` values (use `.env.example`)
- Hand-edit lockfiles — regenerate them with the package manager
- Disable linters, type checks, or security scanners to get a build through

---

## Endpoint testing

Every endpoint (each route + method) must have tests for: **success**, **invalid input** (`400`/`422`), **unauthenticated** (`401`), **forbidden** (`403`/`404`), **not found** (`404`), **conflicts** (`409`) where applicable, **persisted side effects** (read the data back), and **edge cases** (empty lists, pagination bounds, max lengths). Skip a category only when it genuinely doesn't apply, and note why in the test file.

- Test through the HTTP layer with an in-process client (Supertest, FastAPI `TestClient`, `httptest`, `MockMvc`).
- Use the real database with migrations applied — never mock your own DB or business logic. Mock only third-party services. This project has a single Supabase project (`hng-shop`), a non-production test project that the test suite also uses, so tests must create their own uniquely-tagged rows and delete them afterwards — never truncate tables or touch rows they didn't create.
- Assert status, headers, body, and error format; validate responses against the OpenAPI/JSON schema when one exists.
- Name tests by behaviour (`POST /v1/users returns 422 when email is missing`) and keep them deterministic (fake clocks, seeded data, no test-order dependence).

Full coverage table, patterns, and TypeScript/Python examples: **[docs/testing.md](docs/testing.md)**.

### Coverage and CI

- New and changed code must have **≥ 80% line and branch coverage**; overall coverage must not decrease.
- CI runs exactly the commands in [Commands](#commands). If it passes locally but fails in CI, the CI result wins — fix it, don't bypass it.

## Validating that endpoints work

Before marking endpoint work complete:

1. Run the **full** test suite, plus lint and type checks. Fix any regressions you caused.
2. Start the server and confirm `GET /health` returns `200`.
3. Call every new or changed endpoint with real requests — at least one success and one failure case each:
   ```bash
   curl -i -X POST http://localhost:3000/v1/todos \
     -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
     -d '{"title":"Smoke test"}'
   ```
4. Check the server logs for errors, warnings, or unhandled rejections during those requests.
5. Update `docs/openapi.yaml` (or equivalent) if the contract changed.
6. In your final message or PR, list the tests added, the test run result, and the requests you made with their responses.

If a step can't be completed (missing credentials, service down), stop and report exactly what was and wasn't verified.

---

## API conventions

- **Versioning:** all routes are prefixed with a major version (`/v1/...`). Breaking changes require a new version or a documented deprecation period (`Deprecation` and `Sunset` headers) — never break an existing contract silently.
- **Methods & status codes:** `GET` is safe; `PUT`/`PATCH`/`DELETE` are idempotent; `POST` creates and returns `201` with a `Location` header; `204` for empty success.
- **Errors:** use [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457) with `Content-Type: application/problem+json`:
  ```json
  {
    "type": "https://example.com/problems/validation-error",
    "title": "Request validation failed",
    "status": 422,
    "detail": "1 field is invalid",
    "instance": "/v1/todos",
    "errors": [{ "field": "title", "message": "is required" }]
  }
  ```
  Never leak stack traces, SQL, or internal IDs in error responses.
- **Pagination:** cursor-based. Accept `?limit=` (default 20, max 100) and `?cursor=`; respond with `{ "data": [...], "nextCursor": "..." | null }`.
- **Data formats:** JSON field names in `camelCase`; timestamps in ISO 8601 UTC (`2026-09-28T14:30:00Z`); IDs as opaque strings (UUID/ULID); money as integer minor units plus a currency code.
- **Validation:** validate all input at the boundary with a schema library (Zod, Pydantic, etc.) and derive the OpenAPI spec from — or check it against — the same schemas.

## Database & migrations

- Every schema change ships as a **versioned migration file** committed with the code that needs it. Never edit a migration that has already been merged — add a new one.
- Migrations must be **reversible** (include a down step) or explicitly documented as irreversible with a rollback plan.
- Prefer backward-compatible, multi-step changes for live tables (add column → backfill → switch reads → drop old column in a later release).
- Tests run against the **migrated** schema, never an ORM auto-sync.
- Use parameterized queries or the ORM — never build SQL with string concatenation.

## Observability

- Structured (JSON) logs with a **request ID** on every request; accept and propagate `X-Request-Id` / W3C `traceparent`.
- Expose `GET /health` (liveness) and, where dependencies exist, `GET /ready` (checks DB and other critical services).
- Never log secrets, tokens, passwords, or full personal data.

## Security

- Every non-public endpoint enforces authentication **and** authorization, and both are tested.
- Keep secrets in environment variables; document every required variable in `.env.example`.
- Apply rate limiting and request body size limits to public endpoints.

---

## Commands

<!-- TEMPLATE: replace with the project's real commands. Agents should also check package.json, pyproject.toml, or Makefile. -->

| Task | Command |
| --- | --- |
| Install dependencies | `npm install` |
| Start dev server | `npm run dev` |
| Run migrations (local) | `npm run db:migrate` |
| Run all tests | `npm test` |
| Run one test file | `npm test -- path/to/file.test.ts` |
| Coverage report | `npm test -- --coverage` |
| Lint | `npm run lint` |
| Type check | `npm run typecheck` |
| Build | `npm run build` |

## Code style

- Match the style, naming, and structure of surrounding code; prefer existing utilities over new dependencies.
- Keep changes focused — don't refactor unrelated code in the same change.

## Git & pull requests

- Branch from `main` and open a PR; use [Conventional Commits](https://www.conventionalcommits.org) (`feat(api): add POST /v1/todos`).
- PR description: what changed, why, how it was tested (commands + results), and follow-ups.

## Definition of done

- [ ] Every new/changed endpoint has tests covering the required categories
- [ ] Full test suite, lint, and type checks pass; coverage threshold met
- [ ] Endpoints validated against a running server (success and failure cases)
- [ ] Migrations included and reversible, if the schema changed
- [ ] API docs updated if the contract changed
- [ ] No secrets, debug logs, or skipped tests left behind
