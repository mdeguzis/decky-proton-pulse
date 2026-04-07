// scripts/check-translations.ts
// Audit translation coverage by comparing each language's leaf values
// against the English canonical tree. Fails if any language drops below 90%.
//
// Run: npx tsx scripts/check-translations.ts
//   or: pnpm run check-translations
//
// Parses .ts source files with regex to avoid importing React and
// other runtime deps that dont exist in the script context.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const MIN_COVERAGE = 90;

// brand names / technical terms that are legitimately the same in every language
const SKIP_VALUES = new Set([
  'GPU', 'RAM', 'ProtonDB', 'GitHub', 'NVIDIA', 'AMD', 'Intel', 'Debug',
  'Kernel', 'Valve Proton',
]);

// keys where the value is a path/placeholder, not translatable text
const SKIP_KEYS = new Set([
  'compatTools.zipPlaceholder',
]);

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);
const SRC = join(_dirname, '..', 'src', 'lib');

// ── extract string keys from a TranslationTree object in source ───────────
// walks the source text character-by-character to properly handle nested
// braces in arrow function bodies (like Russian pluralization)

function extractStringKeys(source: string): Map<string, string> {
  const keys = new Map<string, string>();

  // find the start of the TranslationTree object
  const treeStart = source.indexOf('TranslationTree = {');
  if (treeStart === -1) return keys;

  // find the opening brace
  let pos = source.indexOf('{', treeStart);
  if (pos === -1) return keys;

  // state
  const sectionStack: string[] = [];
  let depth = 0;
  let i = pos;

  while (i < source.length) {
    const ch = source[i];

    // skip string literals so braces inside strings dont confuse us
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch;
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === '\\') i++; // skip escaped chars
        i++;
      }
      i++; // skip closing quote
      continue;
    }

    // skip line comments
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      i++;
      continue;
    }

    if (ch === '{') {
      depth++;
      i++;
      continue;
    }

    if (ch === '}') {
      depth--;
      if (depth <= 0) break; // end of the whole tree

      // check if this closes a section (not a function body)
      // a section close means depth just dropped to the section's level
      while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].startsWith(`d${depth + 1}:`)) {
        sectionStack.pop();
      }

      i++;
      continue;
    }

    // try to match a key-value pair at current position
    // look for: word: 'value' or word: "value" patterns (simple string values)
    if (/[a-zA-Z_]/.test(ch)) {
      // extract word at current position
      let wordEnd = i;
      while (wordEnd < source.length && /[\w]/.test(source[wordEnd])) wordEnd++;

      const word = source.substring(i, wordEnd);

      // skip whitespace after word
      let afterWord = wordEnd;
      while (afterWord < source.length && /\s/.test(source[afterWord])) afterWord++;

      if (source[afterWord] === ':') {
        // skip whitespace after colon
        let afterColon = afterWord + 1;
        while (afterColon < source.length && /\s/.test(source[afterColon])) afterColon++;

        const nextChar = source[afterColon];

        if (nextChar === '{') {
          // this is a section start like `common: {`
          sectionStack.push(`d${depth + 1}:${word}`);
          i = afterColon; // let the { handler increment depth
          continue;
        }

        if (nextChar === "'" || nextChar === '"') {
          // simple string value - extract it
          const quote = nextChar;
          let strStart = afterColon + 1;
          let strEnd = strStart;
          while (strEnd < source.length && source[strEnd] !== quote) {
            if (source[strEnd] === '\\') strEnd++;
            strEnd++;
          }
          const val = source.substring(strStart, strEnd);

          // build the full key path from section stack
          const sections = sectionStack
            .map(s => s.replace(/^d\d+:/, ''))
            .join('.');
          const fullPath = sections ? `${sections}.${word}` : word;
          keys.set(fullPath, val);

          i = strEnd + 1;
          continue;
        }

        // function or other value type, skip it
        // just advance past the word
        i = afterColon;
        continue;
      }
    }

    i++;
  }

  return keys;
}

// ── main ──────────────────────────────────────────────────────────────────

const enSource = readFileSync(join(SRC, 'i18n.ts'), 'utf-8');
const enKeys = extractStringKeys(enSource);
const totalKeys = enKeys.size;

const langFiles: { code: string; name: string; file: string }[] = [
  { code: 'de', name: 'Deutsch', file: 'de.ts' },
  { code: 'es', name: 'Español', file: 'es.ts' },
  { code: 'fr', name: 'Français', file: 'fr.ts' },
  { code: 'ja', name: '日本語', file: 'ja.ts' },
  { code: 'ko', name: '한국어', file: 'ko.ts' },
  { code: 'pt-BR', name: 'Português', file: 'pt-BR.ts' },
  { code: 'ru', name: 'Русский', file: 'ru.ts' },
  { code: 'tr', name: 'Türkçe', file: 'tr.ts' },
  { code: 'zh-CN', name: '简体中文', file: 'zh-CN.ts' },
];

console.log(`\nTranslation Coverage Report`);
console.log(`${'='.repeat(70)}`);
console.log(`English string keys: ${totalKeys}`);
console.log(`Minimum coverage: ${MIN_COVERAGE}%`);
console.log(`(Function-based keys are checked via TypeScript, not counted here)\n`);

// table header
console.log(
  'Lang'.padEnd(8) +
  'Name'.padEnd(14) +
  'Translated'.padEnd(13) +
  'Total'.padEnd(8) +
  'Coverage'.padEnd(11) +
  'Status'
);
console.log('-'.repeat(70));

let failed = false;
const untranslatedByLang: Record<string, string[]> = {};

for (const lang of langFiles) {
  const source = readFileSync(join(SRC, 'translations', lang.file), 'utf-8');
  const langKeys = extractStringKeys(source);

  let translated = 0;
  const untranslated: string[] = [];

  for (const [path, enVal] of enKeys) {
    if (SKIP_VALUES.has(enVal) || SKIP_KEYS.has(path)) {
      translated++;
      continue;
    }

    const langVal = langKeys.get(path);

    if (langVal === undefined) {
      untranslated.push(`${path} (MISSING)`);
    } else if (langVal === enVal) {
      // same as english, probably not translated
      untranslated.push(path);
    } else {
      translated++;
    }
  }

  const pct = Math.round((translated / totalKeys) * 100);
  const ok = pct >= MIN_COVERAGE;
  if (!ok) failed = true;
  if (untranslated.length > 0) untranslatedByLang[lang.code] = untranslated;

  console.log(
    lang.code.padEnd(8) +
    lang.name.padEnd(14) +
    `${translated}`.padEnd(13) +
    `${totalKeys}`.padEnd(8) +
    `${pct}%`.padEnd(11) +
    (ok ? 'PASS' : 'FAIL')
  );
}

// detail section
const langsWithGaps = Object.keys(untranslatedByLang);
if (langsWithGaps.length > 0) {
  console.log(`\nUntranslated / same-as-English keys:`);
  console.log('-'.repeat(70));
  for (const code of langsWithGaps) {
    const keys = untranslatedByLang[code];
    console.log(`\n  ${code} (${keys.length} keys):`);
    for (const k of keys) {
      console.log(`    - ${k}`);
    }
  }
}

console.log('');

if (failed) {
  console.error(`FAIL: One or more languages below ${MIN_COVERAGE}% coverage.`);
  process.exit(1);
} else {
  console.log(`All languages at or above ${MIN_COVERAGE}% coverage.`);
}
