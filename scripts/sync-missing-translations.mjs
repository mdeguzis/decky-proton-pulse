#!/usr/bin/env node
// scripts/sync-missing-translations.mjs
//
// Finds keys present in the English translation tree but absent from other
// language files and inserts English fallbacks so tests never fail over a
// missing key. Run this (or let the build run it) whenever new keys are added
// to i18n.ts.
//
// Usage:
//   node scripts/sync-missing-translations.mjs          # fix all files
//   node scripts/sync-missing-translations.mjs --dry-run # report only

import { readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import ts from 'typescript';
import { fileURLToPath } from 'url';

const DRY_RUN = process.argv.includes('--dry-run');

const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);
const ROOT = join(_dirname, '..');
const SRC = join(ROOT, 'src', 'lib');

const TRANSLATION_FILES = [
  'translations/bg.ts', 'translations/cs.ts', 'translations/da.ts',
  'translations/de.ts', 'translations/el.ts', 'translations/es-419.ts',
  'translations/es.ts', 'translations/fi.ts', 'translations/fr.ts',
  'translations/hu.ts', 'translations/it.ts', 'translations/ja.ts',
  'translations/ko.ts', 'translations/nl.ts', 'translations/no.ts',
  'translations/pl.ts', 'translations/pt-BR.ts', 'translations/pt.ts',
  'translations/ro.ts', 'translations/ru.ts', 'translations/sl.ts',
  'translations/sv.ts', 'translations/th.ts', 'translations/tr.ts',
  'translations/uk.ts', 'translations/vi.ts', 'translations/zh-CN.ts',
  'translations/zh-TW.ts',
];

// --- AST helpers (same as check-translations.mjs) ---

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
  if (!found) throw new Error(`Could not find TranslationTree object in ${sourceFile.fileName}`);
  return found;
}

// Returns Map<sectionName, Map<keyName, rawSourceText>>
function collectSectionEntries(objectNode, sourceFile) {
  const sections = new Map();
  for (const prop of objectNode.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    const sectionName = propertyNameText(prop.name, sourceFile);
    if (!sectionName) continue;
    if (!ts.isObjectLiteralExpression(prop.initializer)) continue;

    const keys = new Map();
    for (const child of prop.initializer.properties) {
      if (!ts.isPropertyAssignment(child)) continue;
      const keyName = propertyNameText(child.name, sourceFile);
      if (!keyName) continue;
      keys.set(keyName, normalizedNodeText(child.initializer, sourceFile));
    }
    sections.set(sectionName, { keys, node: prop.initializer });
  }
  return sections;
}

function loadFile(relativePath) {
  const filePath = join(SRC, relativePath);
  const sourceText = readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const tree = findTranslationObject(sourceFile);
  return { filePath, sourceText, sourceFile, tree };
}

// --- English source of truth ---

const en = loadFile('i18n.ts');
const enSections = collectSectionEntries(en.tree, en.sourceFile);

let totalFixed = 0;
let totalFiles = 0;

for (const relPath of TRANSLATION_FILES) {
  let { filePath, sourceText, sourceFile, tree } = loadFile(relPath);
  const langSections = collectSectionEntries(tree, sourceFile);

  const insertions = []; // { insertAfterPos, text }

  for (const [sectionName, { keys: enKeys }] of enSections) {
    const langSection = langSections.get(sectionName);
    if (!langSection) continue; // whole section missing - skip (different problem)

    const langKeys = langSection.keys;
    const sectionNode = langSection.node;

    const missingKeys = [...enKeys.keys()].filter(k => !langKeys.has(k));
    if (missingKeys.length === 0) continue;

    // Detect indentation from the first existing property in this section.
    // Use getStart() to skip leading trivia (whitespace/comments before the token).
    const firstProp = sectionNode.properties[0];
    const firstPropStart = firstProp.getStart(sourceFile);
    const lineStart = sourceText.lastIndexOf('\n', firstPropStart) + 1;
    const indent = sourceText.slice(lineStart, firstPropStart).match(/^(\s*)/)[1];

    // Insert point: after the last property AND its trailing comma separator.
    // PropertyAssignment.end is BEFORE the trailing comma, so inserting there
    // produces a double-comma. Find the comma and skip past it.
    const lastProp = sectionNode.properties[sectionNode.properties.length - 1];
    let insertPos = lastProp.end;
    const afterProp = sourceText.slice(insertPos);
    const commaMatch = afterProp.match(/^(\s*,)/);
    let prefix = '';
    if (commaMatch) {
      insertPos += commaMatch[1].length;
    } else {
      prefix = ',';
    }

    const lines = prefix + missingKeys.map(key => {
      const enValue = enKeys.get(key);
      return `\n${indent}${key}: ${enValue},`;
    }).join('');

    insertions.push({ pos: insertPos, text: lines });

    if (DRY_RUN) {
      console.log(`[dry-run] ${relPath} ${sectionName}: would add ${missingKeys.join(', ')}`);
    } else {
      console.log(`${relPath} ${sectionName}: adding ${missingKeys.join(', ')}`);
    }
    totalFixed += missingKeys.length;
  }

  if (insertions.length === 0) continue;
  totalFiles++;

  if (!DRY_RUN) {
    // Apply insertions in reverse order so positions stay valid
    insertions.sort((a, b) => b.pos - a.pos);
    let patched = sourceText;
    for (const { pos, text } of insertions) {
      patched = patched.slice(0, pos) + text + patched.slice(pos);
    }
    writeFileSync(filePath, patched, 'utf-8');
  }
}

if (totalFixed === 0) {
  console.log('All translation files are up to date.');
} else if (DRY_RUN) {
  console.log(`\n${totalFixed} key(s) missing across ${totalFiles} file(s). Run without --dry-run to fix.`);
  process.exit(1);
} else {
  console.log(`\nAdded ${totalFixed} English fallback key(s) across ${totalFiles} file(s).`);
}
