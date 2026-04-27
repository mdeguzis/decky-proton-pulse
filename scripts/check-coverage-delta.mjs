import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const MAX_DROP = 1.0;
const SHOULD_FAIL = !process.argv.includes('--no-fail');

const _dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(_dirname, '..');
const TS_SUMMARY = join(ROOT, 'coverage', 'ts', 'coverage-summary.json');
const PY_SUMMARY = join(ROOT, 'coverage', 'python', 'coverage.json');
const METRICS_DIR = join(ROOT, 'metrics');
const METRICS_JSON = join(METRICS_DIR, 'coverage-totals.json');

const LABELS = { ts: 'TypeScript', python: 'Python' };

function readCurrentCoverage() {
  const missing = [];
  if (!existsSync(TS_SUMMARY)) missing.push(TS_SUMMARY);
  if (!existsSync(PY_SUMMARY)) missing.push(PY_SUMMARY);
  if (missing.length > 0) {
    console.error('Missing coverage reports:');
    for (const p of missing) console.error(`  ${p}`);
    console.error('Run coverage collection first (pnpm run coverage:check).');
    process.exit(1);
  }

  const ts = JSON.parse(readFileSync(TS_SUMMARY, 'utf-8'));
  const py = JSON.parse(readFileSync(PY_SUMMARY, 'utf-8'));

  return {
    ts: Number(ts.total.lines.pct ?? 0),
    python: Number(py.totals.percent_covered ?? 0),
  };
}

function loadBaselineCoverage() {
  try {
    const raw = execSync('git show HEAD:metrics/coverage-totals.json', { encoding: 'utf8' });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function main() {
  const current = readCurrentCoverage();
  const baseline = loadBaselineCoverage();

  console.log('\nCode Coverage Delta Check');
  console.log('='.repeat(54));
  console.log(`TypeScript lines: ${current.ts.toFixed(1)}%`);
  console.log(`Python lines:     ${current.python.toFixed(1)}%`);

  mkdirSync(METRICS_DIR, { recursive: true });
  const metricsJson = `${JSON.stringify({ ts: current.ts, python: current.python }, null, 2)}\n`;
  const existing = existsSync(METRICS_JSON) ? readFileSync(METRICS_JSON, 'utf-8') : null;
  if (existing !== metricsJson) {
    writeFileSync(METRICS_JSON, metricsJson);
    console.log(`\nWrote ${METRICS_JSON}`);
  } else {
    console.log(`\nUnchanged ${METRICS_JSON}`);
  }

  if (!baseline) {
    console.log('\nNo baseline found — skipping delta check (first run).');
    return;
  }

  const drops = [];
  for (const [key, currentPct] of Object.entries(current)) {
    const baselinePct = baseline[key];
    if (baselinePct === undefined) continue;
    const drop = baselinePct - currentPct;
    if (drop > MAX_DROP) {
      drops.push(
        `  ${LABELS[key] ?? key}: ${baselinePct.toFixed(1)}% → ${currentPct.toFixed(1)}% (drop: ${drop.toFixed(1)}%)`,
      );
    }
  }

  if (drops.length > 0) {
    const msg = `\nFAIL: Code coverage dropped by more than ${MAX_DROP}% from baseline:\n${drops.join('\n')}`;
    if (SHOULD_FAIL) {
      console.error(msg);
      process.exit(1);
    } else {
      console.warn(msg.replace('FAIL:', 'WARN:'));
    }
  } else {
    console.log('\nCoverage delta check passed.');
  }
}

main();
