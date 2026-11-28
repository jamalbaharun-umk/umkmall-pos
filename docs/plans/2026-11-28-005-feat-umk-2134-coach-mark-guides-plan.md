# UMK-2134: step-by-step guides (coach marks) on every screen

Linear: UMK-2134. Design 46 (owner approved 2026-11-28). The CoachMark component lives in `@umkmall/ui`: the owner
allowed this as an exception, like the charts.

## Decisions

- `packages/ui/src/primitives/CoachMark/`: `CoachMark` outlines one element in primary blue and shows a bubble with
  "n dari m", a title, one sentence, and the buttons Lanjut (Selesai on the last step) / Kembali / Lewati panduan. It
  never advances on its own; Escape skips. It is not modal: a labelled group that does not trap focus. Text is 16 px
  (`text-ds-paragraph-desktop`), or 20 px with "Teks besar". `placeBubble` is pure and tested. `POS-COPY.md` lists
  the files a later re-vendor keeps.
- pos-api `pos.guide_progress` (migration 0056) has one row per (store, person, guide) with status `done` or `skipped`.
  The person is the session's actor (owner user id or staff id). `GET /guides/progress`, `PUT /guides/progress/:key`
  `{ status }`, `DELETE /guides/progress[/:key]` ("Ulangi"). Every signed-in person reaches only their own rows, and
  no permission is needed. An agent session is refused. The rows go with the store's purge.
- pos-web `src/guides.ts` holds one guide per navigation screen: 3 steps from shared targets (`page-title`, `panel`,
  `guide-button`), and the till has 5 steps on its own targets (`kasir-search`, `kasir-products`, `kasir-cart`,
  `kasir-total`, `kasir-pay`). The dashboard points at its period switch. `guides.test.ts` fails when a navigation
  screen has no guide, when a target is not carried by any file, or when a bubble is longer than one short sentence.
- `components/guide.tsx` holds `GuideProvider`, mounted in `__root` so the bare till has it too. It loads progress
  once. On the first visit it starts the screen's guide, but only on the screen itself and never on PIN sign-in or
  receipt pages. It stays hidden while any dialog is open (payment, PIN, error, form). Leaving the screen ends the
  guide unsaved. Selesai saves `done` and shows the toast "Panduan ditandai selesai"; Lewati saves `skipped`. A
  failed load opens the error dialog with code `GUIDE_PROGRESS_FAILED` and "Coba lagi", and the screen stays usable.
- "? Panduan" sits beside every page title, and in the till's toolbar.
- Pengaturan > Panduan (`/pengaturan/panduan`, a nav line for everyone): the count seen, "Sudah"/"Belum" per guide,
  Ulangi (opens that screen), Ulangi semua, and the "Teks besar" switch (per device, in localStorage).
- Feature guides that start where a feature starts (kasbon, void, production) are not in this unit. They come with
  those features' own DoD.

## Definition of Done

- [test] `CoachMark.test.tsx`: placement, buttons per step, never a dialog, Escape skips, large text, outline.
- [test] `test/guides.e2e-spec.ts`: mark, replace, Ulangi one or all for that person only, 422, 401, and store B is
  untouched. `test/purge.e2e-spec.ts` seeds the new table.
- [test] pos-web `guides.test.ts`, `guide-rules.test.ts`, `-guides.test.ts`.
- [qa] 375 px and 1280 px: dashboard guide starts once, Lewati keeps it off after a reload, the till's 5 steps, and
  the guide center with Selesai toast.
- [cmd] `npm run lint && npm run typecheck && npm test && npm run build`.
