#!/usr/bin/env node
// Sync the shared scoring module from the proton-pulse-web webui repo.
//
// What this does:
//   1. rsyncs proton-pulse-web/js/lib/scoring/*.js into src/lib/gameStats/_synced/
//   2. Computes a sha256 over the sorted file contents
//   3. Writes that hash + the source path into _synced/SYNC_MANIFEST.json
//      so the staleness check (check-scoring-sync.mjs) can compare on CI
//
// Why a separate script and not inline in the Makefile: keeps the Makefile
// readable, lets us run it from npm scripts too, and gives us a place to put
// the hash logic that the CI checker also reuses.
//
// Run via `make sync-scoring` from the plugin repo root, or directly:
//   node scripts/sync-scoring.mjs

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const WEBUI_SCORING_DIR = path.resolve(PLUGIN_ROOT, '..', 'proton-pulse-web', 'js', 'lib', 'scoring');
const SYNCED_DIR = path.resolve(PLUGIN_ROOT, 'src', 'lib', 'gameStats', '_synced');
const MANIFEST_PATH = path.join(SYNCED_DIR, 'SYNC_MANIFEST.json');

// Sort files so the hash is stable across filesystems
function listScoringFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort();
}

// Match the normalization in check-scoring-sync.mjs so CI on Windows
// (which checks out CRLF) gets the same hash as the Linux baseline
function normalizeForHash(buf) {
  return Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function hashFiles(dir, files) {
  const h = crypto.createHash('sha256');
  for (const f of files) {
    const buf = normalizeForHash(fs.readFileSync(path.join(dir, f)));
    // include filename so reordering / renaming flips the hash
    h.update(f);
    h.update('\0');
    h.update(buf);
    h.update('\0');
  }
  return h.digest('hex');
}

function main() {
  if (!fs.existsSync(WEBUI_SCORING_DIR)) {
    console.error(`ERROR: webui scoring dir not found at ${WEBUI_SCORING_DIR}`);
    console.error('Make sure proton-pulse-web is checked out next to decky-proton-pulse.');
    process.exit(1);
  }

  fs.mkdirSync(SYNCED_DIR, { recursive: true });

  // wipe existing synced .js files first so deletions in webui propagate
  for (const f of fs.readdirSync(SYNCED_DIR)) {
    if (f.endsWith('.js')) fs.unlinkSync(path.join(SYNCED_DIR, f));
  }

  const files = listScoringFiles(WEBUI_SCORING_DIR);
  if (!files.length) {
    console.error(`ERROR: no .js files found in ${WEBUI_SCORING_DIR}`);
    process.exit(1);
  }

  for (const f of files) {
    const src = path.join(WEBUI_SCORING_DIR, f);
    const dst = path.join(SYNCED_DIR, f);
    fs.copyFileSync(src, dst);
    console.log(`  copied  ${f}`);
  }

  const hash = hashFiles(WEBUI_SCORING_DIR, files);
  const manifest = {
    source: 'proton-pulse-web/js/lib/scoring',
    syncedAt: new Date().toISOString(),
    sha256: hash,
    files,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nWrote manifest -> ${path.relative(PLUGIN_ROOT, MANIFEST_PATH)}`);
  console.log(`sha256: ${hash}`);
}

main();
