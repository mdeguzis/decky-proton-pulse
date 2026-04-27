# CEF Debugging On Steam Deck

This doc covers the quickest way to inspect Steam Deck web views when a plugin flow opens an external page that renders blank, silently fails, or behaves differently from a desktop browser.

## Remote Setup

Bootstrap the Deck-side helpers once:

```bash
cd decky-proton-pulse
make setup-remote-dev DECK_IP=$(cat ~/.deckip)
```

That installs the narrow sudoers rules used by our remote dev helpers and enables the Deck-side files needed for CEF debugging and live reload.

## Enable The Debugger

Verify the Deck's CEF debugger is reachable:

```bash
cd decky-proton-pulse
make cef-debug-enable DECK_IP=$(cat ~/.deckip)
```

Expected success output:

```text
CEF debugging enabled. Connect at http://<deck-ip>:8081 in a Chromium browser.
```

You can also verify the endpoint directly:

```bash
curl -s http://$(cat ~/.deckip):8081/json/version
```

If that returns browser metadata and a `webSocketDebuggerUrl`, the debugger is live.

You can also save a local metadata pack similar to `make get-logs`:

```bash
make get-cef-capture DECK_IP=$(cat ~/.deckip)
```

That writes a timestamped pack under `../cef-captures/` with:

- `capture.json`
- `version.json`
- `targets.json`
- `summary.txt`

## Open The Right Target

From a Chromium-based browser on your dev machine:

1. Open `http://$(cat ~/.deckip):8081`
2. Click `Steam Big Picture Mode`
3. Open the DevTools `Console` and `Network` tabs
4. On the Deck, reproduce the issue

For external browser flows such as Proton Pulse account linking:

1. Generate the link code in the plugin
2. Press `Open profile to link`
3. Watch the Big Picture target in DevTools while the Deck browser opens

## What To Check First

### Console

Look for:

- `Uncaught` exceptions
- `TypeError`
- CSP or mixed-content failures
- auth or JWT errors
- failed module/script loads

### Network

Reload the affected page on the Deck and watch for:

- `plugin-link.html`
- `plugin-link.css`
- `plugin-link.js`
- Supabase edge function requests
- redirects that never complete

If a blank page appears with no console errors, the Network tab is usually the next best signal.

## Game Page Button Or Injected UI Patch Is Missing

When a button, badge, or shortcut patch does not show up on a Steam game page, check these together:

1. the current Steam route
2. the live DOM in CEF DevTools
3. Proton Pulse frontend logs

Start with:

```bash
DECK_IP=$(cat ~/.deckip) make cef-debug-enable
DECK_IP=$(cat ~/.deckip) make get-logs
```

Then:

1. Open the target game page on the Deck.
2. On your desktop, open `http://<deck-ip>:8081`.
3. Pick the Steam CEF target and open DevTools.
4. In the Elements panel, inspect the action row near the controller and gear icons.
5. In the Console, verify the current route:

```js
window.location.pathname
```

6. Check whether Proton Pulse's injected node already exists:

```js
document.getElementById('proton-pulse-game-page-shortcut')
```

7. If it does not exist, inspect the nearby buttons manually:

```js
[...document.querySelectorAll('button,[role="button"]')]
  .filter((node) => node instanceof HTMLElement && node.offsetParent !== null)
  .map((node) => {
    const rect = node.getBoundingClientRect();
    return {
      text: node.textContent?.trim() ?? '',
      className: node.className,
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  });
```

This usually shows whether Steam changed the action row layout or button sizing in a recent client update.

Frontend log lines to look for:

- `Observed focused library app route`
- `Experimental game page shortcut toggled`
- `Syncing experimental game page shortcut button`
- `Experimental game page shortcut anchor not found`
- `Experimental game page shortcut anchor found`
- `Experimental game page shortcut inserted`

Interpretation:

- If you never see `Syncing experimental game page shortcut button`, the route hook is not firing.
- If you see `anchor not found`, Steam's current DOM layout no longer matches the injected-button heuristics.
- If you see `inserted` but nothing is visible, Steam may be restyling or removing the injected node after insertion.

For that last case, keep DevTools open and watch the Elements panel while moving between game pages.

## Capture A HAR

If the Network list is not enough, export a HAR from DevTools and inspect it locally.

Typical workflow:

1. Open DevTools on `Steam Big Picture Mode`
2. Clear the Network tab
3. Reproduce the issue on the Deck
4. Save the HAR
5. Inspect the latest file in `~/Downloads`

Example inspection commands:

```bash
jq '.log.entries | length' ~/Downloads/<capture>.har
jq -r '.log.entries[] | [.request.method, .response.status, .request.url] | @tsv' ~/Downloads/<capture>.har
```

Useful interpretation:

- If the HAR contains the expected page and JS requests, focus on response codes and script errors.
- If the HAR contains only unrelated Steam UI assets, the external page likely never loaded in the inspected target.

## Current Plugin-Link Debug Notes

During the Proton Pulse account-link investigation on 2026-04-20:

- The CEF debugger was reachable at `http://<deck-ip>:8081`
- The correct inspect target was `Steam Big Picture Mode`
- A saved HAR in `~/Downloads/steamloopback.host.har` contained only 5 requests:
  - 3 to `cdn.akamai.steamstatic.com`
  - 2 to `steamloopback.host`
- That HAR did not include `plugin-link.html`, `plugin-link.js`, or Supabase calls

That pattern suggests the captured traffic was from the Steam shell itself, not the Proton Pulse external linking page. When this happens, keep DevTools open on `Steam Big Picture Mode`, clear Network, trigger the Deck flow again, and confirm the page actually loads in the inspected target before drawing conclusions from the HAR.

## Screenshot Limitation

CEF remote debugging is still very useful for external Deck browser pages, but do not assume it can reliably capture screenshots for them the same way it does for Steam's internal UI surfaces.

What still works well:

- listing live CEF targets
- reading page DOM and text content
- checking console and network state
- running small JS probes through the DevTools protocol

What is less reliable for external browser pages:

- screenshot capture as the source of truth for the visible Deck browser page

In practice:

- use CEF debugging to inspect state for external pages
- use manual Deck screenshots when you need to verify what the user actually sees
- use desktop-browser screenshots when the goal is layout/debugging rather than Steam Deck browser rendering

## Related Commands

```bash
make get-logs DECK_IP=$(cat ~/.deckip)
make reload DECK_IP=$(cat ~/.deckip)
make live-reload-enable DECK_IP=$(cat ~/.deckip)
```

Use `make get-logs` when the plugin itself may be failing before the external page opens. Use CEF DevTools when the Deck browser opens but renders a blank or broken page.
