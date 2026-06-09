#!/usr/bin/env node
// Verify the synced scoring module hasn't drifted from the canonical source
// in proton-pulse-web. Runs as part of the plugin's build (see package.json).
//
// What this does:
//   1. Loads src/lib/gameStats/_synced/SYNC_MANIFEST.json (written by
//      sync-scoring.mjs at the time of the last sync)
//   2. Re-hashes the current files in src/lib/gameStats/_synced/
//   3. Fails the build if the recomputed hash doesn't match the manifest --
//      that means someone hand-edited a synced file, which is forbidden:
//      edits MUST go in the canonical proton-pulse-web/js/lib/scoring/ repo
//      and then `make sync-scoring` brings them back
//
// If the webui repo is checked out at ../proton-pulse-web, also compare
// against the live upstream and warn if the local sync is behind master --
// but don't fail the build for that case (the user might have local
// unpushed webui changes they havent synced yet, and a dev machine without
// the webui repo at all shouldn't be blocked from building)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, '..');
const SYNCED_DIR = path.resolve(PLUGIN_ROOT, 'src', 'lib', 'gameStats', '_synced');
const MANIFEST_PATH = path.join(SYNCED_DIR, 'SYNC_MANIFEST.json');
const WEBUI_SCORING_DIR = path.resolve(PLUGIN_ROOT, '..', 'proton-pulse-web', 'js', 'lib', 'scoring');

// Normalize CRLF -> LF before hashing so Windows checkouts (which git
// converts to CRLF by default) produce the same hash as the Linux/macOS
// baseline. Without this the CI Windows build was failing with
// "Expected sha256: aca9... Got sha256: 0802..." even though the file
// content was identical apart from line endings
function normalizeForHash(buf) {
  return Buffer.from(buf.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function hashFiles(dir, files) {
  const h = crypto.createHash('sha256');
  for (const f of files) {
    const buf = normalizeForHash(fs.readFileSync(path.join(dir, f)));
    h.update(f);
    h.update('\0');
    h.update(buf);
    h.update('\0');
  }
  return h.digest('hex');
}

function listScoringFiles(dir) {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
}

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    fail(
      `No SYNC_MANIFEST.json at ${MANIFEST_PATH}\n` +
        '  Run `make sync-scoring` to populate the synced scoring module.',
    );
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const currentFiles = listScoringFiles(SYNCED_DIR);
  const expectedFiles = manifest.files.slice().sort();

  if (currentFiles.join(',') !== expectedFiles.join(',')) {
    fail(
      `Synced file list does not match manifest.\n` +
        `  Manifest: ${expectedFiles.join(', ')}\n` +
        `  Found:    ${currentFiles.join(', ')}\n` +
        '  Run `make sync-scoring` to repair.',
    );
  }

  const currentHash = hashFiles(SYNCED_DIR, currentFiles);
  if (currentHash !== manifest.sha256) {
    fail(
      `Synced scoring files have been edited locally.\n` +
        `  Expected sha256: ${manifest.sha256}\n` +
        `  Got sha256:      ${currentHash}\n` +
        '  Do NOT edit files in src/lib/gameStats/_synced/ directly.\n' +
        '  Edit proton-pulse-web/js/lib/scoring/ instead, then run `make sync-scoring`.',
    );
  }

  // Optional upstream drift check (warn only). Skipped on CI runners that
  // don't have proton-pulse-web checked out alongside this repo
  if (fs.existsSync(WEBUI_SCORING_DIR)) {
    const upstreamFiles = listScoringFiles(WEBUI_SCORING_DIR);
    if (upstreamFiles.join(',') !== currentFiles.join(',')) {
      console.warn(
        `  warn: upstream proton-pulse-web has different file list than synced copy.\n` +
          `        Upstream: ${upstreamFiles.join(', ')}\n` +
          `        Synced:   ${currentFiles.join(', ')}\n` +
          `        Run \`make sync-scoring\` to update.`,
      );
    } else {
      const upstreamHash = hashFiles(WEBUI_SCORING_DIR, upstreamFiles);
      if (upstreamHash !== currentHash) {
        console.warn(
          `  warn: upstream proton-pulse-web has new content not yet synced into the plugin.\n` +
            `        Upstream sha256: ${upstreamHash}\n` +
            `        Synced sha256:   ${currentHash}\n` +
            `        Run \`make sync-scoring\` to refresh.`,
        );
      }
    }
  }

  console.log(`scoring sync ok: ${currentFiles.length} file(s), sha256 ${currentHash.slice(0, 12)}`);
}

main();
