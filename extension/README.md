# reknown — LinkedIn Photo Enricher (browser extension)

This is a small browser add-on that works with the [reknown](https://douglastkaiser.github.io/reknown/) flashcard app. When you click a button inside reknown, it quietly opens each of your LinkedIn connections' profile pages **using your own already-logged-in LinkedIn session**, grabs their profile photo, and saves it to your reknown deck. Nothing leaves your computer — no servers, no accounts, no API keys.

**You only need to install this once.** After that, every time you import new LinkedIn connections into reknown, you can click one button to pull in their photos.

---

## What you'll need (5 minutes)

1. **A computer** running Firefox or Chrome (or any Chromium browser like Edge, Brave, Arc).
2. **A LinkedIn account** that you are logged into in the same browser.
3. **The reknown extension files.** You can either:
   - **(Easiest)** Download a pre-built ZIP from GitHub Actions — see ["Option A"](#option-a-download-the-pre-built-zip-easiest) below, **or**
   - **(Also fine)** Clone / download this whole repo as a ZIP — see ["Option B"](#option-b-download-the-whole-repo).

Pick **Option A** if you just want it working. Pick **Option B** if you're already a little git-curious or you want to tinker with the code.

---

## Option A: Download the pre-built ZIP (easiest)

Every time code on the `main` branch changes, GitHub automatically builds the extension and publishes the files as a downloadable artifact. Here's how to grab them:

1. Open this link in your browser:
   <https://github.com/douglastkaiser/reknown/actions/workflows/extension.yml>
2. You'll see a list of runs. Click the **topmost one that has a green ✓** next to it (that's the most recent successful build).
3. Scroll down to the **Artifacts** section at the bottom of the page.
4. You'll see two files:
   - **`reknown-extension-chrome`** — download this if you use Chrome, Edge, Brave, Arc, or any other Chromium browser.
   - **`reknown-extension-firefox`** — download this if you use Firefox.
5. Click the one you want. It will download as a `.zip` file (GitHub wraps everything in a zip, even the `.xpi`).
6. **Unzip the file you just downloaded.** Inside you'll find either:
   - A `reknown-extension-chrome-1.0.0.zip` (for Chrome), **or**
   - A `reknown-extension-firefox-1.0.0.xpi` (for Firefox).

> **Note:** you need to be signed into GitHub to download artifacts. If you don't have a GitHub account, use Option B instead — it's just as easy.

Now skip to ["Install the extension in your browser"](#install-the-extension-in-your-browser).

---

## Option B: Download the whole repo

If you don't want to mess with GitHub Actions, you can just grab the source code. The extension is plain JavaScript with no build step — the files you download ARE the extension.

1. Go to <https://github.com/douglastkaiser/reknown>.
2. Click the green **`<> Code`** button near the top.
3. Click **Download ZIP**.
4. Unzip the downloaded file somewhere you'll remember — your Desktop is fine. You'll end up with a folder called `reknown-main`.
5. Inside `reknown-main`, find the folder called `extension`. **That folder is the extension.** (On Chrome you'll point at this folder directly. On Firefox you'll point at the `manifest.json` file inside it.)

Now continue below.

---

## Install the extension in your browser

### If you're using Chrome (or Edge / Brave / Arc / any Chromium browser)

1. Open a new tab and type `chrome://extensions` in the address bar, then press Enter.
   - On Edge, it's `edge://extensions`. On Brave, `brave://extensions`. Same idea everywhere.
2. In the top-right of that page, there's a toggle labeled **Developer mode**. Turn it **on**.
3. Three new buttons will appear on the top-left. Click **Load unpacked**.
4. A file picker opens.
   - **If you used Option A (the zip from Actions):** first unzip the `reknown-extension-chrome-1.0.0.zip` file. You'll get a folder. Select that folder here.
   - **If you used Option B (the repo):** select the `extension` folder inside the `reknown-main` folder you unzipped.
5. You should now see a card labeled **"reknown — LinkedIn Photo Enricher"** on the extensions page. That means it's installed! You can close the extensions tab.

> **Heads up:** Chrome may show a yellow "Disable developer mode extensions" warning every time you restart. It's harmless — just click the X on the warning. The extension will keep working.

### If you're using Firefox

Firefox has two flavors of install. The **temporary** one is easiest but disappears when you close Firefox. The **permanent** one requires one extra step.

#### Temporary install (works until you close Firefox)

1. Open a new tab and type `about:debugging#/runtime/this-firefox` in the address bar, press Enter.
2. Click **Load Temporary Add-on…**.
3. A file picker opens. Find and select the **`manifest.json`** file:
   - **Option A users:** first unzip your downloaded `.xpi`. Wait — don't unzip it! Instead, skip to the permanent install just below; XPI files install directly in Firefox.
   - **Option B users:** navigate into `reknown-main/extension/` and pick `manifest.json`.
4. Done. You should see the extension appear in the list. It will work until you close Firefox. Next time you open Firefox, repeat step 1–3.

#### Permanent install (keeps working forever)

This is the easiest Firefox path **if you used Option A**:

1. Unzip the `reknown-extension-firefox` file you downloaded from GitHub Actions. Inside you'll find a file ending in `.xpi` — e.g. `reknown-extension-firefox-1.0.0.xpi`.
2. **Drag that `.xpi` file directly onto an open Firefox window.**
3. Firefox will ask if you want to install the add-on. Click **Continue to installation**, then **Add**.
4. That's it — it's installed permanently.

> If Firefox refuses to install the XPI because it's "not signed", you have two options:
> - Use the temporary install above (re-do after every Firefox restart), **or**
> - Use [Firefox Developer Edition](https://www.mozilla.org/en-US/firefox/developer/) or Firefox Nightly, which allow unsigned add-ons if you go to `about:config` and set `xpinstall.signatures.required` to `false`.

---

## Using it for the first time

1. **Make sure you're logged into LinkedIn** in the same browser where you installed the extension. Open <https://www.linkedin.com/> in a new tab and confirm you can see your feed. If you see a login page, log in first.
2. Open reknown: <https://douglastkaiser.github.io/reknown/> (or whatever URL you use).
3. Make sure you've imported your LinkedIn CSV first. If you haven't, go to the **People** tab in reknown → **Import CSV** → follow the on-screen steps (there are also instructions on reknown's **About** page).
4. Still on the People tab, you should now see a new section at the top called **"Enrich Photos from LinkedIn"** with a button like `Enrich (47)` (where 47 = the number of people with a LinkedIn URL but no photo yet).
   - **If you don't see that section,** the extension isn't being detected. Try: refresh the page, make sure the extension is enabled in your browser's extensions page, and make sure the URL you're visiting reknown on matches one of the supported origins (see below).
5. Click **Enrich**. A progress bar appears. Photos stream in one by one — leave the tab open and let it run. By default, the extension uses a conservative **`safe`** throttle profile (about 4–7 seconds per person, 60-second pause every 12 people) to reduce LinkedIn rate-limit risk.
6. When it's done, you'll see a summary like `Added photos for 43 of 47 people. 4 failed.` You can click **Retry failed** to try the stragglers again.

---

## Things that can go wrong (and how to fix them)

- **"LinkedIn login wall" error and the batch aborts.** Your LinkedIn session expired or LinkedIn wants you to verify something. Open linkedin.com in another tab, log in / do the verification, come back to reknown, and click **Retry failed**.
- **"Rate limited" error.** LinkedIn thinks you're going too fast. Wait 15–30 minutes before trying again. The extension already throttles, but if you've been browsing LinkedIn aggressively in the same session it can still trip.
- **Some people got "No photo found".** Not everyone has a public profile photo, or LinkedIn is showing only the default silhouette for them. The extension skips those on purpose.
- **A saved photo is wrong — it shows *your own* profile picture instead of theirs.** This happened with older versions of the extension: when LinkedIn returned a page that only contained the logged-in viewer's photo, the parser could fall back to it. The current parser detects this and refuses to save the viewer's own photo (it reports `Profile owner mismatch` instead), so newly-fetched photos are safe. To fix entries that were saved incorrectly by an older version, use the **Recheck** button in the "Enrich Photos from LinkedIn" section — it re-fetches and overwrites photos for people who already have one. For a single person, click **Wrong photo** on their card to clear the image, then run **Enrich** again.
- **The "Enrich" button never appears in reknown.** Double-check: (a) the extension is enabled in `chrome://extensions` / `about:debugging`, (b) you're using reknown on one of the supported URLs (`localhost`, `127.0.0.1`, or `douglastkaiser.github.io`), (c) you refreshed the reknown tab after installing the extension.
- **You self-host reknown on a different domain.** You'll need to edit two files and reload the extension. See ["Supported reknown origins"](#supported-reknown-origins) below.

---

## Safety and privacy

- The extension **only ever fetches** URLs that match `https://www.linkedin.com/in/*`. Nothing else.
- All data (profile HTML, photos, everything) stays on your computer. It's handed to reknown via `window.postMessage` and reknown stores it in IndexedDB — same place as every other photo you'd add manually.
- Throttling is built in with profiles. Default is `safe`: ~4–7 seconds between requests, 60-second pause every 12 requests, instant abort on any rate-limit or login-wall response.
- The content script only runs on reknown's origins. It won't interfere with LinkedIn browsing, even though it has permission to fetch from LinkedIn in the background.

---

## Throttle profiles (until UI toggle exists)

The extension supports two profiles:

- `safe` (**default**) — slower and safer for LinkedIn:
  - `perRequestMinMs=4000`
  - `perRequestJitterMs=3000` (so each request waits ~4–7s)
  - `batchSize=12`
  - `batchPauseMs=60000`
- `normal` — legacy/faster behavior:
  - `perRequestMinMs=2000`
  - `perRequestJitterMs=2000` (so each request waits ~2–4s)
  - `batchSize=25`
  - `batchPauseMs=30000`

### Switch profile from the web app page (message-based)

Open DevTools Console on the reknown tab and run:

```js
window.postMessage({
  type: 'REKNOWN_ENRICH_SET_PROFILE',
  profile: 'safe', // or 'normal'
  requestId: 'profile-' + Date.now()
}, window.location.origin);
```

Then listen for the ack:

```js
window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  if (event.data?.type === 'REKNOWN_ENRICH_PROFILE') {
    console.log('profile response', event.data);
  }
});
```

To fetch the current profile/config:

```js
window.postMessage({
  type: 'REKNOWN_ENRICH_GET_PROFILE',
  requestId: 'profile-get-' + Date.now()
}, window.location.origin);
```

Profile is persisted in extension local storage and reused on the next browser/session start.

---

## Supported reknown origins

The extension is injected into reknown only on these URLs (listed in `manifest.json`):

- `http://localhost:*` — for local development
- `http://127.0.0.1:*` — for local development
- `https://douglastkaiser.github.io/*` — the public deployment

**To add another origin** (e.g. if you self-host reknown at `https://reknown.mydomain.com`):

1. Open `extension/manifest.json` and add your URL to `content_scripts[0].matches`, e.g. `"https://reknown.mydomain.com/*"`.
2. Open `extension/content-script.js` and add a matching regex to `ALLOWED_ORIGIN_PATTERNS`, e.g. `/^https:\/\/reknown\.mydomain\.com$/`.
3. Reload the extension in your browser (click the circular arrow on its card in `chrome://extensions`, or click "Reload" in `about:debugging`).

---

## For developers

- **No build step.** The extension is plain JavaScript. The files in `extension/` are literally what gets loaded.
- **Packaging.** GitHub Actions builds a Chrome ZIP and Firefox XPI on every push to `main`. See `.github/workflows/extension.yml`.
- **Local packaging.** If you want to build it yourself: `cd extension && zip -r ../reknown-extension.zip .` gives you the Chrome ZIP; rename to `.xpi` for Firefox.
- **Signing for permanent Firefox install:** `npm install -g web-ext`, then `cd extension && web-ext sign --api-key=... --api-secret=...` using credentials from <https://addons.mozilla.org/en-US/developers/addon/api/key/>.
