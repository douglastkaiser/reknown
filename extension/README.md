# reknown — LinkedIn Photo Enricher (browser extension)

A sideloaded browser extension that fetches LinkedIn profile photos for people in your [reknown](https://douglastkaiser.github.io/reknown/) deck, using your own authenticated LinkedIn session.

It runs only when you click "Enrich Photos from LinkedIn" inside reknown. Nothing is sent anywhere else — the extension fetches LinkedIn pages locally, extracts the profile photo URL, downloads the image, and hands the data URL back to reknown via `window.postMessage`. reknown stores the photo in your local IndexedDB (same place as every other photo).

## Install

### Firefox (temporary — development use)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Pick `extension/manifest.json` from this repo.
4. The extension is active until you close Firefox.

### Firefox (permanent — self-signed)

1. `npm install -g web-ext`
2. Get API credentials from <https://addons.mozilla.org/en-US/developers/addon/api/key/>
3. `cd extension && web-ext sign --api-key=YOUR_KEY --api-secret=YOUR_SECRET`
4. Drag the generated `.xpi` into Firefox to install.

### Chrome / Chromium / Edge / Brave

1. Open `chrome://extensions/`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select the `extension/` directory in this repo.
5. The extension persists across restarts in developer mode.

## Using it

1. Open reknown (localhost or the GitHub Pages deployment).
2. Make sure you're logged into LinkedIn in the same browser (open <https://www.linkedin.com/> in another tab and confirm you see your feed).
3. Import your LinkedIn connections CSV into reknown — people will appear without photos.
4. Go to the **People** view. You should see an **Enrich Photos from LinkedIn** panel at the top. If you see an "install the extension" card instead, the extension isn't detected — reload the page.
5. Click the button. Progress will stream in real time; each photo is saved to your local DB as it's fetched.
6. If LinkedIn shows a login wall (session expired, verification required, etc.), the batch will abort. Fix your LinkedIn session and click **Retry**.

## Throttling / safety

- ~2–4 seconds between profile requests, with random jitter.
- 30 second pause after every 25 profiles.
- Batch aborts immediately on 429 / 999 / login wall.
- Only URLs matching `https://www.linkedin.com/in/*` are ever fetched.

## Supported reknown origins

The content script is injected only into these origins (see `manifest.json`):

- `http://localhost:*`
- `http://127.0.0.1:*`
- `https://douglastkaiser.github.io/*`

To add another origin (e.g. a custom deployment), add it to `content_scripts.matches` in `manifest.json` **and** to `ALLOWED_ORIGIN_PATTERNS` in `content-script.js`, then reload the extension.
