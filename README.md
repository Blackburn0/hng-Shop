# Coffee Shop

Online coffee shop: Next.js + Supabase (Postgres, Google auth) + Paystack (test mode) + Mailgun.

- Build plan and status: [plan.md](plan.md)
- Rules for contributors and AI agents: [AGENTS.md](AGENTS.md)
- API contract: [docs/openapi.yaml](docs/openapi.yaml)
- Figma exports: [Design/](Design/)

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in the keys
npm run dev                  # http://localhost:3000, health at /health
```

| Task | Command |
| --- | --- |
| Tests | `npm test` |
| Coverage | `npm test -- --coverage` |
| Lint / types | `npm run lint` · `npm run typecheck` |
| Push migrations (linked project) | `npm run db:migrate` |
