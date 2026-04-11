import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const TS_SUMMARY_PATH = path.join(
  ROOT,
  "coverage",
  "ts",
  "coverage-summary.json",
);
const PY_SUMMARY_PATH = path.join(ROOT, "coverage", "python", "coverage.json");
const MIN_COVERAGE = 90;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function formatPercent(value) {
  return `${Number(value).toFixed(1)}%`;
}

function statusFor(percent) {
  return percent >= MIN_COVERAGE ? "PASS" : "FAIL";
}

function pad(value, width) {
  return String(value).padEnd(width, " ");
}

function main() {
  const tsSummary = readJson(TS_SUMMARY_PATH);
  const pySummary = readJson(PY_SUMMARY_PATH);

  const rows = [
    {
      language: "TypeScript",
      coverage: Number(tsSummary.total.lines.pct ?? 0),
    },
    {
      language: "Python",
      coverage: Number(pySummary.totals.percent_covered ?? 0),
    },
  ];

  console.log("\nCoverage Summary");
  console.log(
    `${pad("Language", 12)} ${pad("Coverage", 10)} ${pad("Minimum", 8)} Status`,
  );
  console.log(
    `${pad("--------", 12)} ${pad("--------", 10)} ${pad("-------", 8)} ------`,
  );
  for (const row of rows) {
    console.log(
      `${pad(row.language, 12)} ${pad(formatPercent(row.coverage), 10)} ${pad(formatPercent(MIN_COVERAGE), 8)} ${statusFor(row.coverage)}`,
    );
  }
}
console.log("\n");

main();
