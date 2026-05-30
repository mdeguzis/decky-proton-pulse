// Single source of truth for displaying plugin version labels.
//
// Why this exists: the plugin renders three kinds of "version" string:
//   1. Real semver, eg. "1.7.4"  -> display as "v1.7.4"
//   2. Developer-channel labels, eg. "Developer build (93ae260)" or "main (abc123)"
//      -> display verbatim, no leading "v"
//   3. Anything else from the backend (future channels, edge cases)
//      -> safe default: leading "v" only if it starts with a digit
//
// We kept hand-rolling this rule everywhere (Settings tab toast, About tab,
// updater i18n keys) and just as often forgot it, leading to "vDeveloper
// build (sha)" bugs. Always call formatVersion() instead of inlining the
// regex or hardcoding "v${...}".

export function formatVersion(raw: string | null | undefined): string {
  const v = (raw ?? '').trim();
  if (!v) return '';
  return /^\d/.test(v) ? `v${v}` : v;
}
