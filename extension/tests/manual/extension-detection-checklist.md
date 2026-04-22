# Extension detection de-duplication checklist

Use this quick manual validation whenever updating extension presence detection.

## Setup

1. Build/load the extension and open the web app on an allowed origin.
2. Open DevTools on the page and filter logs by `reknown`.
3. Ensure verbose mode is **off**:
   - no `?reknownExtVerbose=1` in the URL
   - `localStorage.reknownExtensionVerbose` is not `1`
   - `sessionStorage.reknownExtensionVerbose` is not `1`

## Checks

1. Hard-refresh page.
2. Verify exactly one `REKNOWN_EXTENSION_DETECTED` message is observed during startup.
3. Focus/blur the tab repeatedly for 10 seconds.
   - Expected: no additional detect events are emitted in normal mode.
4. Trigger explicit reconnect from console:
   ```js
   window.postMessage({ type: 'REKNOWN_EXTENSION_PING', explicitReconnect: true }, window.location.origin);
   ```
   - Expected: one new detect event is emitted after reconnect.
5. Enable verbose mode (`localStorage.reknownExtensionVerbose = '1'`, then reload).
   - Expected: repeated focus/ping chatter returns for startup debugging.
