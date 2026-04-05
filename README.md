# Reknown

A mobile-first spaced-repetition app for memorizing people from your network.

## Problem statement

Remembering names, faces, and context after events, outreach, or hiring pipelines is hard when your contact list grows quickly. Reknown turns your people data into review cards so you can keep relationships warm and recall details on demand.

## Setup

```bash
npm install && npm run dev
```

## How SM-2 and card types work

Reknown schedules cards with an SM-2 style model:
- Each card tracks interval, repetitions, ease factor, and due date.
- Your review grade updates ease and spacing so difficult cards return sooner and easy cards are delayed.
- Session queues are generated from due cards and bounded by app settings.

Card types supported:
- `name_to_face`: prompt with a name, recall the face.
- `face_to_name`: prompt with a face, recall the name.
- `headline`: recall role/headline context.
- `company`: recall workplace context.

Card-type weights in settings control how frequently each type appears.

## Objective metrics definitions

Reknown stores objective review telemetry in IndexedDB and computes dashboard metrics from those records:

- `reviewEvents` store (one row per reviewed card):
  - `cardId`
  - `cardType`
  - `outcome` (`accepted` or `rejected`)
  - `score` (SM-2 quality `0..5`)
  - `timestamp` (Unix epoch milliseconds)
  - `mode` (`manual_grade`, `typed_guess`, or `multiple_choice`)
- `sessionSummaries` store (one row per completed session):
  - `correct`
  - `incorrect`
  - `accuracy` (`correct / (correct + incorrect) * 100`)
  - `timestamp`

Deterministic scoring and outcomes:

- Manual grading (`manual_grade`): `accepted` when quality is `>= 3`, otherwise `rejected`.
- Typed face-to-name (`typed_guess`):
  - exact match ⇒ quality `5`, `accepted`
  - partial/close string overlap ⇒ quality `3`, `rejected`
  - mismatch ⇒ quality `1`, `rejected`
- Face multiple-choice (`multiple_choice`): correct option ⇒ quality `5`, `accepted`; wrong option ⇒ quality `1`, `rejected`.

Dashboard metrics:

- **Got it %** = overall accepted rate across all `reviewEvents`.
- **Needs work %** = `100 - Got it %`.
- Per-mode/type slices:
  - **Face→Name accuracy** = accepted rate where `cardType = face_to_name`.
  - **Face MC accuracy** = accepted rate where `cardType = face_to_name` and `mode = multiple_choice`.
- Trend windows:
  - **Trend (7d)** = accepted rate for events with `timestamp >= now - 7 days`.
  - **Trend (30d)** = accepted rate for events with `timestamp >= now - 30 days`.

## LinkedIn CSV import instructions

1. Export your connections from LinkedIn as CSV.
2. Open Reknown and go to **Import**.
3. Upload the CSV file or paste CSV text.
4. Reknown attempts LinkedIn-specific parsing first, then falls back to generic CSV parsing.
5. Confirm the preview to seed people into your review pool.

## Starter data behavior

- On first run, Reknown checks the local IndexedDB people store.
- If there are zero people, it preloads a small starter set of public figures.
- This first-run seed is idempotent for app startup: it only runs when the local database is empty.
- You can delete any starter person from the **People** screen at any time.

### Replacing starter data with LinkedIn CSV

1. Export your LinkedIn connections CSV.
2. Open **Import** in Reknown.
3. Upload or paste the CSV and confirm the preview.
4. Imported rows are added to your database; if you want a clean list, delete starter entries first, then import.


## GitHub Pages publishing

This repository uses **GitHub Actions-based Pages deployment** from `main`.

Release flow:

1. Push changes to `main`.
2. GitHub Actions runs install + build and deploys the `dist/` artifact to Pages via `.github/workflows/deploy.yml`.
3. Do **not** commit generated `docs/` output for publishing.

Base path requirement for project Pages deployments:

- Vite's `base` is configured from `VITE_BASE_PATH` and defaults to `/reknown/` for this repository.
- For `https://<user>.github.io/<repo>/` deployments, set `VITE_BASE_PATH` to `/<repo>/` (for this repo: `/reknown/`).
- `BrowserRouter` uses `import.meta.env.BASE_URL` as `basename`, so wildcard redirects (for unknown routes) continue routing to `/home` under the same base path.

## Stack

- React 18 + TypeScript
- Vite 5
- vite-plugin-pwa + Workbox
- Tailwind CSS
- IndexedDB (`idb`)
- Vitest + Playwright

## Screenshot / GIF placeholders

- Add an app screenshot and review-flow GIF to this section when assets are available.

## License

This project is licensed under the MIT License (see `LICENSE`).
