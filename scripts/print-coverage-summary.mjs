import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

  const header = `${pad("Language", 12)} ${pad("Coverage", 10)} ${pad("Minimum", 8)} Status`;
  const divider = `${pad("--------", 12)} ${pad("--------", 10)} ${pad("-------", 8)} ------`;
  const border = "=".repeat(Math.max(header.length, divider.length, 54));

  console.log(`\n${border}`);
  console.log("Coverage Summary");
  console.log(border);
  console.log(header);
  console.log(divider);
  for (const row of rows) {
    console.log(
      `${pad(row.language, 12)} ${pad(formatPercent(row.coverage), 10)} ${pad(formatPercent(MIN_COVERAGE), 8)} ${statusFor(row.coverage)}`,
    );
  }
  console.log(border);
}
console.log("\n");

main();
