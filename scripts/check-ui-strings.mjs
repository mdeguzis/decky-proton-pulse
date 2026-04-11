import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, relative } from 'path';
import ts from 'typescript';
import { fileURLToPath } from 'url';

const SHOULD_FAIL = !process.argv.includes('--no-fail');
const _filename = fileURLToPath(import.meta.url);
const _dirname = dirname(_filename);
const ROOT = join(_dirname, '..');
const SRC = join(ROOT, 'src');
const METRICS_DIR = join(ROOT, 'metrics');
const METRICS_JSON = join(METRICS_DIR, 'ui-string-scan.json');
const METRICS_MD = join(METRICS_DIR, 'ui-string-scan.md');

const INCLUDE_SEGMENTS = ['/components/', '/patches/'];
const EXCLUDE_SEGMENTS = ['/translations/', '.test.', '/__tests__/'];
const UI_PROPS = new Set(['label', 'description', 'title', 'body', 'placeholder', 'tooltip']);
const IGNORED_CALLEES = new Set(['logFrontendEvent']);
const IGNORE_TEXT = [
  /^Proton Pulse$/,
  /^https?:\/\//,
  /^#?[0-9a-f]{3,8}$/i,
  /^rgba?\(/i,
  /^linear-gradient/i,
  /^%command%$/,
  /^AppID\b/,
  /^[A-Z0-9_]+$/,
  /^[./]/,
];

function shouldInspect(filePath) {
  if (!/\.(ts|tsx)$/.test(filePath)) return false;
  if (!INCLUDE_SEGMENTS.some((segment) => filePath.includes(segment))) return false;
  if (EXCLUDE_SEGMENTS.some((segment) => filePath.includes(segment))) return false;
  return true;
}

function isLikelyUiText(text) {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.length < 3) return false;
  if (!/[A-Za-z]/.test(trimmed)) return false;
  if (IGNORE_TEXT.some((pattern) => pattern.test(trimmed))) return false;
  return true;
}

function calleeName(node) {
  if (ts.isIdentifier(node)) return node.text;
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  return null;
}

function shouldIgnoreStringNode(node) {
  const parent = node.parent;
  if (!parent) return true;
  if (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
  if (ts.isJsxAttribute(parent)) {
    return !UI_PROPS.has(parent.name.text);
  }
  if (ts.isPropertyAssignment(parent)) {
    const name = ts.isIdentifier(parent.name) || ts.isStringLiteral(parent.name) ? parent.name.text : null;
    return !name || !UI_PROPS.has(name);
  }
  if (ts.isCallExpression(parent)) {
    const name = calleeName(parent.expression);
    if (name && IGNORED_CALLEES.has(name)) return true;
  }
  return true;
}

function collectFiles(dir, out = []) {
  for (const entry of ts.sys.readDirectory(dir, ['.ts', '.tsx'], undefined, undefined)) {
    if (shouldInspect(entry)) out.push(entry);
  }
  return out;
}

function scanFile(filePath) {
  const sourceText = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const findings = [];

  const pushFinding = (node, text, kind) => {
    if (!isLikelyUiText(text)) return;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    findings.push({
      file: relative(ROOT, filePath),
      line: line + 1,
      column: character + 1,
      kind,
      text: text.trim(),
    });
  };

  const visit = (node) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !shouldIgnoreStringNode(node)) {
      pushFinding(node, node.text, 'string');
    } else if (ts.isJsxText(node)) {
      pushFinding(node, node.getText(sourceFile), 'jsx');
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
}

function renderMarkdown(findings) {
  const lines = [
    'Potential hardcoded UI strings found outside the translation tree.',
    '',
    '| File | Line | Kind | Text |',
    '|---|---:|---|---|',
  ];
  for (const finding of findings) {
    lines.push(`| \`${finding.file}\` | ${finding.line} | ${finding.kind} | ${finding.text.replace(/\|/g, '\\|')} |`);
  }
  return `${lines.join('\n')}\n`;
}

function main() {
  const files = collectFiles(SRC);
  const findings = files.flatMap(scanFile);
  mkdirSync(METRICS_DIR, { recursive: true });
  writeFileSync(METRICS_JSON, JSON.stringify({
    generatedAt: new Date().toISOString(),
    scannedFiles: files.map((file) => relative(ROOT, file)),
    findings,
  }, null, 2));
  writeFileSync(METRICS_MD, renderMarkdown(findings));

  console.log('\nUI String Scan');
  console.log('='.repeat(78));
  console.log(`Scanned files: ${files.length}`);
  console.log(`Potential hardcoded UI strings: ${findings.length}`);
  console.log(`Wrote ${METRICS_JSON}`);
  console.log(`Wrote ${METRICS_MD}`);

  if (findings.length) {
    console.log('\nTop findings:');
    console.log('-'.repeat(78));
    for (const finding of findings.slice(0, 25)) {
      console.log(`${finding.file}:${finding.line}:${finding.column} [${finding.kind}] ${finding.text}`);
    }
  } else {
    console.log('\nNo likely hardcoded UI strings were found in the scanned UI sources.');
  }

  if (findings.length && SHOULD_FAIL) {
    process.exit(1);
  }
}

main();
