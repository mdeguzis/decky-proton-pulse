# Compatibility Tools Notes

## Current Downloader Strategy

Proton-GE release management currently uses a curl-first download path from `main.py`.

Why:
- The Steam Deck has shown unreliable behavior with Python's default TLS path for GitHub downloads.
- Historical failures seen in plugin logs:
  - `curl` hitting GitHub `HTTP/2 PROTOCOL_ERROR` on archive downloads
  - Python `urlopen` hitting `CERTIFICATE_VERIFY_FAILED`

Current mitigations:
- Force `curl` to use HTTP/1.1 for GitHub release metadata and archive downloads
- Retry transient download failures with curl before considering fallback
- Keep Python fallback only as a backup path, not the preferred path

## Latest Slot Behavior

The plugin treats the newest managed Proton-GE install as a stable slot:
- directory name: `Proton-GE-Latest`
- metadata file tracks which actual upstream tag that slot represents

This allows auto-update to:
- replace the latest slot when a newer upstream GE release appears
- report whether the current latest release is already satisfied by the slot

## Known Problem Areas

### 1. GitHub archive downloads can still hang

Even with curl-first behavior, logs have shown sessions where the install reaches:
- release resolved
- archive download via curl started

but never reaches:
- download finished
- extract started
- finalize started

That indicates the current live blocker can still be the archive download step itself.

### 2. Python TLS fallback is still not trustworthy on Deck

If curl fails and Python fallback is used, the Deck has previously logged:
- `CERTIFICATE_VERIFY_FAILED`

This is why Python should not remain the primary GitHub transport.

## Future Plan

Short term:
- keep hardening curl behavior for GitHub downloads
- improve stage logging so download/extract/finalize stalls are obvious in logs
- audit current backend/frontend logging and move low-signal operational chatter from `INFO` to `DEBUG` where appropriate

Better long-term fix:
- replace GitHub release/download networking with a tiny Rust helper
- use `reqwest + rustls`, similar in spirit to Wine Cellar's backend

Possible alternative:
- explicitly repair Python CA handling with a known-good SSL context

Rust is the preferred future direction because it avoids depending on the Deck's Python/OpenSSL certificate environment.
