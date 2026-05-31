// Danger.js rules for Proton Pulse PRs.
// Enforces 100% i18n coverage unless a maintainer override is active.
//
// Override options (either one works):
//   - Add the label:           skip-i18n-check
//   - Add to PR description:   [skip i18n]

import { readFileSync, existsSync } from "fs";

const SKIP_LABEL   = "skip-i18n-check";
const SKIP_KEYWORD = "[skip i18n]";
const COVERAGE_FILE = "metrics/translation-coverage.json";

const prLabels  = (danger.github.issue.labels || []).map(l => l.name);
const prBody    = danger.github.pr.body || "";
const overridden = prLabels.includes(SKIP_LABEL) ||
                   prBody.toLowerCase().includes(SKIP_KEYWORD.toLowerCase());

if (overridden) {
  message("i18n coverage check skipped (maintainer override active).");
} else if (!existsSync(COVERAGE_FILE)) {
  warn(
    `\`${COVERAGE_FILE}\` not found. ` +
    "The translation check may not have run. Re-run CI or run `pnpm run check-translations` locally."
  );
} else {
  const coverage  = JSON.parse(readFileSync(COVERAGE_FILE, "utf8"));
  const languages = coverage.languages.filter(l => !l.canonical);
  const minPct    = coverage.minimumCoveragePercent;
  const failing   = languages.filter(l => l.coveragePercent < minPct);

  if (failing.length === 0) {
    message(
      `i18n: all ${languages.length} languages at 100% coverage` +
      ` (${coverage.totalKeys} keys).`
    );
  } else {
    const rows = failing.map(lang => {
      const missing = lang.total - lang.translated;
      return `| ${lang.name} (\`${lang.code}\`) | ${lang.coveragePercent.toFixed(1)}% | ${missing} |`;
    }).join("\n");

    let details = "";
    const withMissing = failing.filter(l => l.missingKeys?.length > 0);
    if (withMissing.length > 0) {
      const blocks = withMissing.map(lang =>
        `**${lang.name} (\`${lang.code}\`):**\n\`\`\`\n${lang.missingKeys.join("\n")}\n\`\`\``
      ).join("\n\n");
      details = `\n\n<details>\n<summary>Missing keys by language</summary>\n\n${blocks}\n\n</details>`;
    }

    fail(
      `### i18n coverage below 100%\n\n` +
      `${failing.length} of ${languages.length} languages need translation updates ` +
      `(minimum: ${minPct}%).\n\n` +
      `| Language | Coverage | Missing keys |\n` +
      `|---|---|---|\n` +
      `${rows}` +
      details +
      `\n\n---\n` +
      `To override: add the \`${SKIP_LABEL}\` label to this PR, ` +
      `or include \`${SKIP_KEYWORD}\` in the PR description.`
    );
  }
}
