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

## LinkedIn CSV import instructions

1. Export your connections from LinkedIn as CSV.
2. Open Reknown and go to **Import**.
3. Upload the CSV file or paste CSV text.
4. Reknown attempts LinkedIn-specific parsing first, then falls back to generic CSV parsing.
5. Confirm the preview to seed people into your review pool.

## Stack

- React 18 + TypeScript
- Vite 5
- vite-plugin-pwa + Workbox
- Tailwind CSS
- IndexedDB (`idb`)
- Vitest + Playwright

## Screenshot / GIF placeholders

- Add an app screenshot at `docs/images/dashboard.png`
- Add a review-flow GIF at `docs/images/review-flow.gif`
- Update this section with embedded media when assets are available.

## License

This project is licensed under the MIT License (see `LICENSE`).
