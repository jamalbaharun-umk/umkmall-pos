# pos-web

[← Back to the project README](../../README.md)

The merchant web app of UMKMall POS, for desktop and phone. TanStack Start (React 19) on Vite and Nitro, styled with
Tailwind CSS 4 and [`@umkmall/ui`](../../packages/ui/README.md). Interface language: Indonesian.
How to use each screen: [user guide](../../README.md#-user-guide).

## Run

Start [pos-api](../pos-api/README.md) first, then from the repository root:

```bash
POS_API_URL=http://localhost:3000 POS_DEV_USER_ID=<user id> npm run dev -w pos-web
```

Open http://localhost:3101. Full steps: [local setup](../../README.md#-run-it-locally).

| Variable | Meaning |
|---|---|
| `POS_API_URL` | Where pos-api is |
| `UMKMALL_WEB_URL` | UMKMall login page for signed-out owners (unset locally) |
| `POS_WEB_URL` | This app's public origin, used as the login return address |
| `POS_DEV_USER_ID` | Local only: enables **Masuk (pengembangan)** |

```bash
npm run typecheck -w pos-web && npm test -w pos-web && npm run build -w pos-web
```

## Layout

| Path | Content |
|---|---|
| `src/routes/` | One folder per area: `kasir`, `catalog`, `staf`, `laporan`, `pengaturan`, … |
| `src/nav.ts` | The whole navigation: label, route, permission |
| `src/components/` | App shell, page layout, confirm and feedback dialogs |
| `src/lib/feedback.ts` | Success toast or error dialog for every action |
| `src/lib/api.server.ts` | Server-side calls to pos-api |
| `src/styles/app.css` | The UMKMall admin theme |

## Rules

- Use only `@umkmall/ui` components and the admin theme.
- Every action ends in a success toast or a clear error dialog.
- Every screen has loading, empty and error states, on desktop and phone widths.
- A new screen adds one line to `src/nav.ts`.

## Libraries

TanStack Router and Start, React 19, Vite 8, Nitro, Tailwind CSS 4, `tw-animate-css`, lucide-react,
`qrcode-generator`; Vitest and TypeScript for checks.
