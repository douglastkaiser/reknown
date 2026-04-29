# Extension detection release verification checklist

Use this manual QA checklist before release whenever extension presence/detection behavior changes.

## Setup

1. Build/load the extension and open the web app on an allowed origin.
2. Open DevTools on the page:
   - **Console** filtered by `reknown`
   - **Network** (optional) to observe app bootstrap
3. Ensure verbose mode is **off**:
   - no `?reknownExtVerbose=1` in the URL
   - `localStorage.reknownExtensionVerbose` is not `1`
   - `sessionStorage.reknownExtensionVerbose` is not `1`
4. If you test multiple routes in one tab, hard-refresh between cases to avoid carrying state.

## Route matrix to test

Run **all** assertions in [Verification assertions](#verification-assertions) for each URL variant below.

### A) No query params

1. `/reknown/`
2. `/reknown/?/people`
3. `/reknown/#/people` (if hash routing is enabled in the build/environment)

### B) With query params

1. `/reknown/?foo=bar`
2. `/reknown/?/people?foo=bar`
3. `/reknown/#/people?foo=bar` (if hash routing is enabled in the build/environment)

> Notes:
> - Keep query param names/values stable across runs to simplify log comparison.
> - If your local app origin differs, keep the same path/query/hash combinations.

## Verification assertions

For each route variant above, verify all of the following:

1. **Content script injected**
   - Expected: extension content script is active on page load.
   - Evidence options:
     - `window.__REKNOWN_EXTENSION__`-style marker exists (if exposed), or
     - console logs from `content-script.js` startup appear, or
     - extension DevTools "content script" context is present for the page.

2. **Ping/detected message exchanged**
   - Expected: page emits ping and receives extension detected response.
   - Example events to confirm in logs/message inspector:
     - `REKNOWN_EXTENSION_PING`
     - `REKNOWN_EXTENSION_DETECTED`

3. **`extensionAvailable` flips `true`**
   - Expected: app state transitions from not-detected to detected after handshake.
   - Verify via UI behavior and/or debug logs tied to `useExtensionDetection`.

4. **Enrich button visible when eligible > 0**
   - Precondition: People dataset includes at least one eligible person.
   - Expected: Enrich Photos action/button is visible in People view once extension is detected.
   - Negative control: if eligible count is `0`, button can remain hidden/disabled (not a failure).

## Pass criteria

- Every tested route variant satisfies all 4 assertions.
- No duplicate/spurious detection loops in normal (non-verbose) mode during idle focus/blur.
- Any failures are captured with route, exact URL, console excerpts, and whether query params/hash were present.
