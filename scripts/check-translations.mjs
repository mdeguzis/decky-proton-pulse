import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import ts from 'typescript';
import { fileURLToPath } from 'url';

// Strict 100% required. Every string in every supported language must
// differ from the canonical English. Brand names (Proton, Steam, Decky
// Loader, Glorious Eggroll, Proton Pulse) stay in-line where they appear
// inside translated sentences -- only standalone equals-English strings
// fail the gate.
const MIN_COVERAGE = 100;
const MAX_COVERAGE_DROP = 1.0; // fail if any locale drops more than this % from committed baseline
const README_START = '<!-- translation-coverage:start -->';
const README_END = '<!-- translation-coverage:end -->';
const SHOULD_FAIL_ON_LOW_COVERAGE = !process.argv.includes('--no-fail');

const SKIP_VALUES = new Set([
  'GPU', 'RAM', 'CPU', 'ProtonDB', 'GitHub', 'NVIDIA', 'AMD', 'Intel', 'Debug',
  'Kernel', 'Valve Proton',
  'VRAM', 'PASS', 'FAIL', 'MAYBE', 'Info', 'Status', 'Platform', 'No',
  'Demo',
  // UI style terms used as loanwords in many languages (Swedish, Turkish, etc.)
  'Full', 'Compact', 'Minimal', 'Off',
  // Common international loanwords in tech/gaming contexts -- legitimately same in many European languages
  'Bronze', 'General', 'Experimental', 'Local', 'Global', 'Driver', 'Type', 'Error', 'Match',
  // Loanwords used verbatim in many European languages (de, nl, pl, sv, cs, no for "Trend"; fr for "Stable")
  'Trend', 'Stable',
]);

const SKIP_KEYS = new Set([
  'compatTools.zipPlaceholder',
  'manage.protondbConfig',
  'configManager.customToggleBadge',
  'nativeReport.verdictQuestion',
  'nativeReport.derivedRatingLabel',
  'nativeReport.faultPerformance',
  'nativeReport.faultGraphical',
  'nativeReport.faultWindowing',
  'nativeReport.faultAudio',
  'nativeReport.faultInput',
  'nativeReport.faultStability',
  'nativeReport.faultSaveGame',
  'nativeReport.faultSignificantBugs',
  'extras.compatVersionColumn',
  // Function-typed loanwords: "Trend" is the same in de/nl/pl/sv/cs/no and
  // "Stable" is the same in fr. SKIP_VALUES doesn't apply because these are
  // function entries, not bare strings, so we skip by key path instead
  'extras.analysisTrend',
  'extras.analysisTrend_stable',
  // "Source" is the same word in French and English -- legitimate
  'extras.breakdownSourcePenalty',
]);

const LANGUAGES = [
  { code: 'en', name: 'English', file: 'i18n.ts', canonical: true },
  { code: 'de', name: 'Deutsch', file: 'translations/de.ts' },
  { code: 'es', name: 'Español', file: 'translations/es.ts' },
  { code: 'fr', name: 'Français', file: 'translations/fr.ts' },
  { code: 'it', name: 'Italiano', file: 'translations/it.ts' },
  { code: 'ja', name: '日本語', file: 'translations/ja.ts' },
  { code: 'ko', name: '한국어', file: 'translations/ko.ts' },
  { code: 'nl', name: 'Nederlands', file: 'translations/nl.ts' },
  { code: 'pl', name: 'Polski', file: 'translations/pl.ts' },
  { code: 'pt-BR', name: 'Português (BR)', file: 'translations/pt-BR.ts' },
  { code: 'ru', name: 'Русский', file: 'translations/ru.ts' },
  { code: 'tr', name: 'Türkçe', file: 'translations/tr.ts' },
  { code: 'uk', name: 'Українська', file: 'translations/uk.ts' },
  { code: 'sv', name: 'Svenska', file: 'translations/sv.ts' },
  { code: 'cs', name: 'Čeština', file: 'translations/cs.ts' },
  { code: 'th', name: 'ภาษาไทย', file: 'translations/th.ts' },
  { code: 'vi', name: 'Tiếng Việt', file: 'translations/vi.ts' },
  { code: 'zh-CN', name: '简体中文', file: 'translations/zh-CN.ts' },
  { code: 'zh-TW', name: '繁體中文', file: 'translations/zh-TW.ts' },
  { code: 'bg', name: 'Български', file: 'translations/bg.ts' },
  { code: 'da', name: 'Dansk', file: 'translations/da.ts' },
  { code: 'el', name: 'Ελληνικά', file: 'translations/el.ts' },
  { code: 'es-419', name: 'Español (Latinoamérica)', file: 'translations/es-419.ts' },
  { code: 'fi', name: 'Suomi', file: 'translations/fi.ts' },
  { code: 'hu', name: 'Magyar', file: 'translations/hu.ts' },
  { code: 'no', name: 'Norsk', file: 'translations/no.ts' },
  { code: 'pt', name: 'Português (PT)', file: 'translations/pt.ts' },
  { code: 'ro', name: 'Română', file: 'translations/ro.ts' },
  { code: 'sl', name: 'Slovenščina', file: 'translations/sl.ts' },
];

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);
const ROOT = join(_dirname, '..');
const SRC = join(ROOT, 'src', 'lib');
const README = join(ROOT, 'README.md');
const METRICS_DIR = join(ROOT, 'metrics');
const METRICS_JSON = join(METRICS_DIR, 'translation-coverage.json');
const METRICS_MD = join(METRICS_DIR, 'translation-coverage.md');

function propertyNameText(name, sourceFile) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  if (ts.isComputedPropertyName(name) && ts.isStringLiteral(name.expression)) {
    return name.expression.text;
  }
  return name.getText(sourceFile);
}

function normalizedNodeText(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/g, ' ').trim();
}

function stringLiteralValue(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function isFunctionExpression(node) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node);
}

function findTranslationObject(sourceFile) {
  let found = null;

  const visit = (node) => {
    if (found) return;
    if (
      ts.isVariableDeclaration(node)
      && node.initializer
      && ts.isObjectLiteralExpression(node.initializer)
      && node.type
      && node.type.getText(sourceFile) === 'TranslationTree'
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (!found) {
    throw new Error(`Could not find TranslationTree object in ${sourceFile.fileName}`);
  }

  return found;
}

function collectEntries(objectNode, sourceFile, prefix = '', out = new Map()) {
  for (const property of objectNode.properties) {
    if (!ts.isPropertyAssignment(property)) {
      continue;
    }

    const name = propertyNameText(property.name, sourceFile);
    if (!name) {
      continue;
    }

    const path = prefix ? `${prefix}.${name}` : name;
    const init = property.initializer;

    if (ts.isObjectLiteralExpression(init)) {
      collectEntries(init, sourceFile, path, out);
      continue;
    }

    const literalValue = stringLiteralValue(init);
    if (literalValue !== null) {
      out.set(path, {
        path,
        kind: 'string',
        stringValue: literalValue,
        normalizedSource: normalizedNodeText(init, sourceFile),
      });
      continue;
    }

    if (isFunctionExpression(init)) {
      out.set(path, {
        path,
        kind: 'function',
        normalizedSource: normalizedNodeText(init, sourceFile),
      });
    }
  }

  return out;
}

function loadEntries(relativePath) {
  const filePath = join(SRC, relativePath);
  const sourceText = readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return collectEntries(findTranslationObject(sourceFile), sourceFile);
}

function isSkipped(entry) {
  return SKIP_KEYS.has(entry.path) || (entry.kind === 'string' && entry.stringValue !== undefined && SKIP_VALUES.has(entry.stringValue));
}

function coveragePercent(translated, total) {
  return Number(((translated / total) * 100).toFixed(1));
}

function formatCoverage(value) {
  return `${value.toFixed(1)}%`;
}

function charDisplayWidth(char) {
  const code = char.codePointAt(0) ?? 0;
  if (
    (code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2329 && code <= 0x232a)
    || (code >= 0x2e80 && code <= 0xa4cf)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe19)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1f64f)
    || (code >= 0x1f900 && code <= 0x1f9ff)
    || (code >= 0x20000 && code <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

function displayWidth(text) {
  return Array.from(text).reduce((sum, char) => sum + charDisplayWidth(char), 0);
}

function padDisplay(text, width) {
  const padding = Math.max(0, width - displayWidth(text));
  return text + ' '.repeat(padding);
}

function compareAgainstEnglish(language, englishEntries) {
  if (language.canonical) {
    return {
      code: language.code,
      name: language.name,
      canonical: true,
      translated: englishEntries.size,
      total: englishEntries.size,
      coveragePercent: 100,
      missingKeys: [],
      sameAsEnglishKeys: [],
      typeMismatches: [],
    };
  }

  const candidateEntries = loadEntries(language.file);
  const missingKeys = [];
  const sameAsEnglishKeys = [];
  const typeMismatches = [];
  let translated = 0;

  for (const [key, englishEntry] of englishEntries) {
    if (isSkipped(englishEntry)) {
      translated++;
      continue;
    }

    const translatedEntry = candidateEntries.get(key);
    if (!translatedEntry) {
      missingKeys.push(key);
      continue;
    }

    if (translatedEntry.kind !== englishEntry.kind) {
      typeMismatches.push(`${key} (${englishEntry.kind} -> ${translatedEntry.kind})`);
      continue;
    }

    if (
      (englishEntry.kind === 'string' && translatedEntry.stringValue === englishEntry.stringValue)
      || translatedEntry.normalizedSource === englishEntry.normalizedSource
    ) {
      sameAsEnglishKeys.push(key);
      continue;
    }

    translated++;
  }

  return {
    code: language.code,
    name: language.name,
    translated,
    total: englishEntries.size,
    coveragePercent: coveragePercent(translated, englishEntries.size),
    missingKeys,
    sameAsEnglishKeys,
    typeMismatches,
  };
}

function renderMetricsMarkdown(metrics) {
  const lines = [
    'Generated from [metrics/translation-coverage.json](metrics/translation-coverage.json) during `pnpm run build`.',
    '',
    `Proton Pulse supports ${metrics.length} languages. Translation coverage is measured during build and can be enforced with \`pnpm run check-translations\` (${MIN_COVERAGE}% minimum).`,
    '',
    '| Language | Code | Coverage | Status |',
    '|---|---|---|---|',
  ];

  for (const metric of metrics) {
    const status = metric.canonical
      ? 'canonical'
      : metric.coveragePercent >= MIN_COVERAGE ? 'pass' : 'fail';
    const coverage = metric.canonical
      ? `${formatCoverage(metric.coveragePercent)} (canonical)`
      : formatCoverage(metric.coveragePercent);
    lines.push(`| ${metric.name} | ${metric.code} | ${coverage} | ${status} |`);
  }

  return `${lines.join('\n')}\n`;
}

function writeIfChanged(filePath, content) {
  const existing = existsSync(filePath) ? readFileSync(filePath, 'utf-8') : null;
  if (existing === content) {
    return false;
  }
  writeFileSync(filePath, content);
  return true;
}

function updateReadme(markdownBody) {
  const readme = readFileSync(README, 'utf-8');
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);

  if (start === -1 || end === -1 || end <= start) {
    throw new Error('README translation coverage markers are missing or malformed.');
  }

  const updated = `${readme.slice(0, start + README_START.length)}\n${markdownBody}${readme.slice(end)}`;
  return writeIfChanged(README, updated);
}

function printConsoleReport(metrics) {
  const totalKeys = metrics[0]?.total ?? 0;

  const printCoverageSummary = () => {
    console.log('\nCoverage Summary:');
    console.log('-'.repeat(78));
    console.log(
      padDisplay('Lang', 8)
      + padDisplay('Name', 18)
      + padDisplay('Translated', 13)
      + padDisplay('Total', 8)
      + padDisplay('Coverage', 11)
      + 'Status',
    );
    console.log('-'.repeat(78));

    for (const metric of metrics) {
      const status = metric.canonical
        ? 'CANONICAL'
        : metric.coveragePercent >= MIN_COVERAGE ? 'PASS' : 'FAIL';
      console.log(
        padDisplay(metric.code, 8)
        + padDisplay(metric.name, 18)
        + padDisplay(String(metric.translated), 13)
        + padDisplay(String(metric.total), 8)
        + padDisplay(formatCoverage(metric.coveragePercent), 11)
        + status,
      );
    }
  };

  console.log('\nTranslation Coverage Report');
  console.log('='.repeat(78));
  console.log(`Canonical translation keys: ${totalKeys}`);
  console.log(`Minimum coverage: ${MIN_COVERAGE}%`);
  console.log('(String and function-valued keys are both checked here.)\n');

  const withGaps = metrics.filter(metric => !metric.canonical && (
    metric.missingKeys.length > 0
    || metric.sameAsEnglishKeys.length > 0
    || metric.typeMismatches.length > 0
  ));

  if (withGaps.length === 0) {
    console.log('\nAll non-English languages are fully translated.');
    printCoverageSummary();
    return;
  }

  console.log('\nTranslation gaps:');
  console.log('-'.repeat(78));

  for (const metric of withGaps) {
    const gapCount = metric.missingKeys.length + metric.sameAsEnglishKeys.length + metric.typeMismatches.length;
    console.log(`\n${metric.code} (${gapCount} gaps)`);

    for (const key of metric.missingKeys) {
      console.log(`  MISSING: ${key}`);
    }
    for (const key of metric.sameAsEnglishKeys) {
      console.log(`  SAME AS ENGLISH: ${key}`);
    }
    for (const key of metric.typeMismatches) {
      console.log(`  TYPE MISMATCH: ${key}`);
    }
  }

  printCoverageSummary();
}


function main() {
  const englishEntries = loadEntries('i18n.ts');
  const metrics = LANGUAGES.map(language => compareAgainstEnglish(language, englishEntries));
  const markdown = renderMetricsMarkdown(metrics);
  const failed = metrics.some(metric => !metric.canonical && metric.coveragePercent < MIN_COVERAGE);
  const metricsJson = `${JSON.stringify({
    minimumCoveragePercent: MIN_COVERAGE,
    totalKeys: englishEntries.size,
    languages: metrics,
  }, null, 2)}\n`;

  mkdirSync(METRICS_DIR, { recursive: true });
  const wroteJson = writeIfChanged(METRICS_JSON, metricsJson);
  const wroteMarkdown = writeIfChanged(METRICS_MD, markdown);
  const wroteReadme = updateReadme(markdown);

  console.log(`\n${wroteJson ? 'Wrote' : 'Unchanged'} ${METRICS_JSON}`);
  console.log(`${wroteMarkdown ? 'Wrote' : 'Unchanged'} ${METRICS_MD}`);
  console.log(`README translation coverage section ${wroteReadme ? 'refreshed.' : 'unchanged.'}`);
  printConsoleReport(metrics);

  // Delta check: compare against committed baseline
  let baselineJson = null;
  try {
    baselineJson = JSON.parse(execSync('git show HEAD:metrics/translation-coverage.json', { encoding: 'utf8' }));
  } catch {
    // No baseline yet (first commit) — skip delta check
  }
  if (baselineJson) {
    const baselineMap = {};
    for (const lang of (baselineJson.languages ?? [])) {
      if (!lang.canonical) baselineMap[lang.code] = lang.coveragePercent;
    }
    const drops = metrics
      .filter(m => !m.canonical && m.code in baselineMap)
      .filter(m => (baselineMap[m.code] - m.coveragePercent) > MAX_COVERAGE_DROP)
      .map(m => `  ${m.code}: ${baselineMap[m.code]}% → ${m.coveragePercent}% (drop: ${(baselineMap[m.code] - m.coveragePercent).toFixed(1)}%)`);
    if (drops.length > 0) {
      const msg = `\nFAIL: Translation coverage dropped by more than ${MAX_COVERAGE_DROP}% from baseline:\n${drops.join('\n')}`;
      if (SHOULD_FAIL_ON_LOW_COVERAGE) {
        console.error(msg);
        process.exit(1);
      } else {
        console.warn(msg.replace('FAIL:', 'WARN:'));
      }
    }
  }

  if (failed && SHOULD_FAIL_ON_LOW_COVERAGE) {
    console.error(`\nFAIL: One or more languages are below ${MIN_COVERAGE}% coverage.`);
    process.exit(1);
  }

  if (failed) {
    console.warn(`\nWARN: One or more languages are below ${MIN_COVERAGE}% coverage.`);
  }
}

main();
