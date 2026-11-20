# umkmall-pos

UMKMall's multi-tenant Point of Sale: a NestJS API (`apps/pos-api`) and a merchant web app (`apps/pos-web`),
ported from [Lakasir](https://github.com/lakasir/lakasir). Licensed GPL-3.0-or-later (see `LICENSE`, `NOTICE`).

- Epic plan: [docs/plans/2026-11-17-001-feat-pos-epic-plan.md](docs/plans/2026-11-17-001-feat-pos-epic-plan.md) (Linear UMK-1924)
- Reference run of Lakasir: [docs/reference/lakasir-findings.md](docs/reference/lakasir-findings.md)
- How to work here: [CLAUDE.md](CLAUDE.md)
- Environment variables: [.env.example](.env.example)

Owners sign in with their UMKMall account: the POS runs under UMKMall's cookie domain (`pos.umkmall.id`) and checks
UMKMall's shared login cookie against `UMKMALL_WEB_URL/api/auth/me` (UMK-1945). Locally, use the dev sign-in in
[CLAUDE.md](CLAUDE.md#commands).

```bash
npm install && npm run db:up && npm test
```
