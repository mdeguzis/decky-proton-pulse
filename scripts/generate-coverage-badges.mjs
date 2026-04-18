import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TS_SUMMARY_PATH = path.join(ROOT, 'coverage', 'ts', 'coverage-summary.json');
const PY_SUMMARY_PATH = path.join(ROOT, 'coverage', 'python', 'coverage.json');
const OUTPUT_DIR = path.join(ROOT, 'coverage', 'site', 'badges');
const MIN_COVERAGE = 90;
const DIFF_MIN_COVERAGE = 95;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function coverageColor(percent) {
  if (percent >= 95) return 'brightgreen';
  if (percent >= 90) return 'green';
  if (percent >= 80) return 'yellowgreen';
  if (percent >= 70) return 'yellow';
  if (percent >= 60) return 'orange';
  return 'red';
}

function writeBadgeJson(fileName, label, percent) {
  const rounded = Number(percent.toFixed(1));
  const payload = {
    schemaVersion: 1,
    label,
    message: `${rounded}%`,
    color: coverageColor(rounded),
  };
  fs.writeFileSync(
    path.join(OUTPUT_DIR, fileName),
    JSON.stringify(payload, null, 2) + '\n',
  );
}

function writeIndexHtml(tsPercent, pyPercent) {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Decky Proton Pulse Coverage Badges</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #16162d;
        --panel: #1e2747;
        --text: #f3f7ff;
        --muted: #94a9c6;
      }
      body {
        margin: 0;
        padding: 32px;
        font-family: ui-sans-serif, system-ui, sans-serif;
        background: radial-gradient(circle at top, #22264a 0%, var(--bg) 60%);
        color: var(--text);
      }
      .panel {
        max-width: 720px;
        margin: 0 auto;
        padding: 24px;
        border-radius: 16px;
        background: color-mix(in srgb, var(--panel) 88%, transparent);
        border: 1px solid rgba(255, 255, 255, 0.08);
      }
      h1 { margin-top: 0; }
      p { color: var(--muted); }
      ul { line-height: 1.8; }
      code { color: #9bd1ff; }
    </style>
  </head>
  <body>
    <div class="panel">
      <h1>Decky Proton Pulse Coverage</h1>
      <p>Published coverage badge endpoints for the latest default-branch run.</p>
      <p>Enforced minimum: <strong>${MIN_COVERAGE.toFixed(1)}%</strong> for Python and TypeScript coverage.</p>
      <p>Pull requests also enforce <strong>${DIFF_MIN_COVERAGE.toFixed(1)}%</strong> diff coverage on changed lines.</p>
      <ul>
        <li>Python coverage: <strong>${pyPercent.toFixed(1)}%</strong> at <code>badges/python-coverage.json</code></li>
        <li>TypeScript coverage: <strong>${tsPercent.toFixed(1)}%</strong> at <code>badges/ts-coverage.json</code></li>
      </ul>
    </div>
  </body>
</html>
`;
  fs.writeFileSync(path.join(ROOT, 'coverage', 'site', 'index.html'), html);
}

function main() {
  ensureDir(OUTPUT_DIR);

  const tsSummary = readJson(TS_SUMMARY_PATH);
  const pySummary = readJson(PY_SUMMARY_PATH);

  const tsPercent = Number(tsSummary.total.lines.pct ?? 0);
  const pyPercent = Number(pySummary.totals.percent_covered ?? 0);

  writeBadgeJson('ts-coverage.json', 'ts coverage', tsPercent);
  writeBadgeJson('python-coverage.json', 'python coverage', pyPercent);
  writeIndexHtml(tsPercent, pyPercent);

  console.log(`Wrote coverage badge data to ${OUTPUT_DIR}`);
  console.log(`Coverage minimum: ${MIN_COVERAGE.toFixed(1)}%`);
  console.log(`Diff coverage minimum: ${DIFF_MIN_COVERAGE.toFixed(1)}%`);
  console.log(`TypeScript coverage: ${tsPercent.toFixed(1)}%`);
  console.log(`Python coverage: ${pyPercent.toFixed(1)}%`);
}

main();
