import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const changelogPath = path.join(repoRoot, 'CHANGELOG.md');

function runGit(command) {
  return execSync(command, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

function tryGit(command) {
  try {
    return runGit(command);
  } catch {
    return '';
  }
}

function readChangelog() {
  return fs.readFileSync(changelogPath, 'utf8');
}

function writeIfChanged(nextContent, unchangedMessage, changedMessage) {
  const previousContent = readChangelog();
  if (previousContent === nextContent) {
    console.log(unchangedMessage);
    return false;
  }

  fs.writeFileSync(changelogPath, nextContent);
  console.log(changedMessage);
  return true;
}

function uniqueBulletsFromMessages(messages) {
  const seen = new Set();
  return messages
    .map(normalizeCommitSubject)
    .filter(Boolean)
    .filter((line) => {
      const key = line.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((line) => `- ${line}`);
}

function bulletKey(line) {
  return line.replace(/^-\s*/, '').trim().toLowerCase();
}

export function filterAlreadyReleasedBullets(bullets, sections) {
  const releasedKeys = new Set();
  for (const section of sections) {
    if (section.heading === '## Unreleased') {
      continue;
    }
    for (const line of section.body.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('- ')) {
        releasedKeys.add(bulletKey(trimmed));
      }
    }
  }

  return bullets.filter((bullet) => !releasedKeys.has(bulletKey(bullet)));
}

export function normalizeCommitSubject(line) {
  return line
    .trim()
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?!?:\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^./, (char) => char.toUpperCase());
}

export function formatReleaseHeading(tagName, { prerelease = false } = {}) {
  const version = tagName.replace(/^v/i, '');
  const baseVersion = version.split('-')[0];
  if (prerelease || version.includes('-')) {
    return `## v${baseVersion} pre-release`;
  }
  return `## v${version}`;
}

export function deckyLoaderReleaseBullet({ prerelease = false } = {}) {
  return prerelease
    ? '- Decky Loader pre-release submission.'
    : '- Decky Loader release submission.';
}

export function appendUniqueBullet(body, bullet) {
  const trimmedBody = body.trim();
  if (!bullet) {
    return trimmedBody;
  }

  const lines = trimmedBody ? trimmedBody.split('\n') : [];
  if (lines.includes(bullet)) {
    return trimmedBody;
  }

  return [...lines, bullet].filter(Boolean).join('\n');
}

function getCommitBulletsForRange(range) {
  if (!range) {
    return [];
  }

  const raw = tryGit(`git log --no-merges --format=%s ${range}`);
  if (!raw) {
    return [];
  }

  return uniqueBulletsFromMessages(raw.split('\n'));
}

function getLatestTagRange() {
  const latestTag = tryGit('git describe --tags --abbrev=0');
  if (!latestTag) {
    return '';
  }
  return `${latestTag}..HEAD`;
}

function splitChangelogSections(content) {
  const sectionRegex = /^## [^\n]+\n/gm;
  const matches = [...content.matchAll(sectionRegex)];
  if (matches.length === 0) {
    return { preamble: content.trimEnd(), sections: [] };
  }

  const preamble = content.slice(0, matches[0].index).trimEnd();
  const sections = matches.map((match, index) => {
    const start = match.index;
    const nextStart = index + 1 < matches.length ? matches[index + 1].index : content.length;
    const sectionText = content.slice(start, nextStart).trimEnd();
    const [heading, ...rest] = sectionText.split('\n');
    return {
      heading,
      body: rest.join('\n').trim(),
    };
  });

  return { preamble, sections };
}

function renderSections(preamble, sections) {
  const blocks = [];

  if (preamble) {
    blocks.push(preamble.trim());
  }

  for (const section of sections) {
    const lines = [section.heading];
    if (section.body) {
      lines.push('', section.body.trim());
    }
    blocks.push(lines.join('\n'));
  }

  return `${blocks.join('\n\n').trim()}\n`;
}

function upsertSection(sections, heading, body, insertAfterHeading = null) {
  const nextSections = [...sections];
  const existingIndex = nextSections.findIndex((section) => section.heading === heading);
  const nextSection = { heading, body: body.trim() };

  if (existingIndex !== -1) {
    nextSections[existingIndex] = nextSection;
    return nextSections;
  }

  if (insertAfterHeading) {
    const anchorIndex = nextSections.findIndex((section) => section.heading === insertAfterHeading);
    if (anchorIndex !== -1) {
      nextSections.splice(anchorIndex + 1, 0, nextSection);
      return nextSections;
    }
  }

  nextSections.unshift(nextSection);
  return nextSections;
}

function getSectionBody(sections, heading) {
  return sections.find((section) => section.heading === heading)?.body.trim() ?? '';
}

function syncUnreleasedFromCommitsSinceLatestTag() {
  const range = getLatestTagRange();
  if (!range) {
    console.log('CHANGELOG.md unchanged: no release tag was found.');
    return false;
  }

  const changelog = readChangelog();
  const { preamble, sections } = splitChangelogSections(changelog);
  const bullets = filterAlreadyReleasedBullets(getCommitBulletsForRange(range), sections);
  const nextSections = upsertSection(sections, '## Unreleased', bullets.join('\n'));
  const nextContent = renderSections(preamble, nextSections);
  return writeIfChanged(
    nextContent,
    'CHANGELOG.md unchanged: unreleased section already matches commits since the latest tag.',
    bullets.length === 0
      ? 'Cleared CHANGELOG.md unreleased section because HEAD matches the latest tag.'
      : 'Updated CHANGELOG.md from commits since the latest tag.'
  );
}

function prepareRelease(tagName, { prerelease = false, deckyLoaderRelease = false } = {}) {
  syncUnreleasedFromCommitsSinceLatestTag();

  const changelog = readChangelog();
  const { preamble, sections } = splitChangelogSections(changelog);
  const unreleasedBody = getSectionBody(sections, '## Unreleased');
  const releaseHeading = formatReleaseHeading(tagName, { prerelease });
  let releaseBody = unreleasedBody;

  if (!releaseBody) {
    const fallbackBullets = getCommitBulletsForRange(getLatestTagRange());
    if (fallbackBullets.length > 0) {
      releaseBody = fallbackBullets.join('\n');
    }
  }

  if (!releaseBody) {
    releaseBody = '- Release notes were autogenerated during release preparation.';
  }

  if (deckyLoaderRelease) {
    releaseBody = appendUniqueBullet(releaseBody, deckyLoaderReleaseBullet({ prerelease }));
  }

  let nextSections = upsertSection(sections, '## Unreleased', '');
  nextSections = upsertSection(nextSections, releaseHeading, releaseBody, '## Unreleased');
  const nextContent = renderSections(preamble, nextSections);

  return writeIfChanged(
    nextContent,
    `CHANGELOG.md already prepared for ${tagName}.`,
    `Prepared CHANGELOG.md for ${tagName}.`
  );
}

function main(argv = process.argv.slice(2)) {
  const mode = argv[0];
  const arg = argv[1];
  const prerelease = argv.includes('--prerelease');
  const deckyLoaderRelease = argv.includes('--decky-loader-release');

  if (mode === '--sync-unreleased') {
    syncUnreleasedFromCommitsSinceLatestTag();
  } else if (mode === '--prepare-release') {
    if (!arg) {
      console.error('Usage: node scripts/sync-changelog.mjs --prepare-release vX.Y.Z [--prerelease] [--decky-loader-release]');
      process.exit(1);
    }
    prepareRelease(arg, { prerelease, deckyLoaderRelease });
  } else {
    console.error('Usage: node scripts/sync-changelog.mjs --sync-unreleased | --prepare-release vX.Y.Z [--prerelease] [--decky-loader-release]');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
