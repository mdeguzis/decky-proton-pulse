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

## Related Commands

```bash
make get-logs DECK_IP=$(cat ~/.deckip)
make reload DECK_IP=$(cat ~/.deckip)
make live-reload-enable DECK_IP=$(cat ~/.deckip)
```

Use `make get-logs` when the plugin itself may be failing before the external page opens. Use CEF DevTools when the Deck browser opens but renders a blank or broken page.
