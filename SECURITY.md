# Security Policy

Thanks for taking the time to look at the Decky Proton Pulse plugin and report anything you find. Real research keeps this project safe for the people who use it.

## Reporting a vulnerability

**Preferred: private GitHub security advisories.** Open one at
<https://github.com/mdeguzis/decky-proton-pulse/security/advisories/new>. Only
the repo owner sees it and you get a private discussion thread to work through
the fix.

**Fallback: email.** Send to <mdeguzis@gmail.com> with the subject line
`[SECURITY] Decky Proton Pulse:` followed by a short summary. Encrypt if you
like (PGP key on request), but not required.

**Please do NOT open a public GitHub issue** for anything that could be used
to attack real users. Once a fix has landed and users have had a chance to
update, we are happy to co-publish an advisory that credits your work.

## What to include

A tight report gets triaged faster:

- What the issue is (one sentence).
- Reproduction steps or a small proof of concept.
- Impact (what an attacker gains, who is affected).
- Anything you already know about a fix.

Screenshots and short video captures are welcome. Do not include real user
data in your report; anonymize identifiers before sharing.

## Response commitments

- **Acknowledge within 72 hours** of receipt.
- **Initial assessment within one week** with either a fix plan or a
  request for more information.
- **Status updates** every week until the issue is closed.
- **Coordinated disclosure** once the fix is deployed and users have had a
  reasonable window to update.

## Scope

**In scope:**

- The plugin frontend (`src/`) and Python backend (`main.py`, `lib/`).
- The self-updater flow (`lib/plugin_updater.py`).
- Launch-option writes to Steam via `SteamClient.Apps.SetAppLaunchOptions`.
- Cloud sync + submit paths that talk to the Proton Pulse Supabase backend.
- The plugin-link handshake between the plugin and the web account.
- GitHub Actions workflows under `.github/workflows/`.

**Out of scope:**

- Decky Loader itself (report to <https://github.com/SteamDeckHomebrew/decky-loader>).
- Steam / Valve infrastructure (report to Valve directly).
- The Proton Pulse web app and its Supabase edge functions -- those have
  their own policy at
  <https://github.com/mdeguzis/proton-pulse-web/blob/main/SECURITY.md>.
  If your finding crosses both, file the primary report in whichever repo
  is more relevant and we will coordinate.
- ProtonDB (we consume their public data, we do not operate it).
- Social engineering of maintainers or contributors.
- Any test that requires DoS, spam, or degrading service for other users.

## Safe harbor

Good-faith security research done under this policy is welcome. Specifically:

- We will not initiate legal action against you for research that stays
  within the scope above.
- We will not report you to law enforcement for good-faith research.
- If you accidentally cross a line while investigating (e.g. you access
  data that is not yours), stop and tell us; we will treat that as part of
  the report, not a violation, so long as you did not exfiltrate or share
  the data.

Please stay within the following bounds:

- Do not attempt to access, modify, or destroy data that is not yours.
- Do not modify another user's Steam launch options as part of a PoC.
- Do not run scans that meaningfully degrade the service for other users.
- Do not use social engineering against maintainers.
- Give us a reasonable window to fix before public disclosure. Default is 90 days, negotiable.

## What we ship to keep the plugin safe

For context on the automated gates in place, see the Security page in the
[plugin wiki](https://github.com/mdeguzis/decky-proton-pulse/wiki/Security)
and the Safety and Security section on the plugin's About tab.

The plugin's cloud sync and submit flows go through the same Supabase
backend that the [Proton Pulse web app](https://github.com/mdeguzis/proton-pulse-web)
runs, so it inherits the CodeQL, Dependabot, npm audit, VirusTotal, RLS,
CSP, rate-limit, and moderation gates documented in the
[Security Guardrails wiki](https://github.com/mdeguzis/proton-pulse-web/wiki/Security-Guardrails)
over there.
