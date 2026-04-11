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
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      if (seen.has(line)) {
        return false;
      }
      seen.add(line);
      return true;
    })
    .map((line) => `- ${line}`);
}

function getCommitBulletsForRange(range) {
  if (!range) {
    return [];
  }

  const raw = tryGit(`git log --format=%s ${range}`);
  if (!raw) {
    return [];
  }

  return uniqueBulletsFromMessages(raw.split('\n'));
}

function getUnpushedRange() {
  const upstream = tryGit('git rev-parse --abbrev-ref --symbolic-full-name @{upstream}');
  if (!upstream) {
    return '';
  }

  const aheadCount = Number.parseInt(tryGit('git rev-list --count @{upstream}..HEAD') || '0', 10);
  if (!aheadCount) {
    return '';
  }

  return '@{upstream}..HEAD';
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

function syncUnreleasedFromUnpushedCommits() {
  const range = getUnpushedRange();
  if (!range) {
    console.log('CHANGELOG.md unchanged: no unpushed commits.');
    return false;
  }

  const bullets = getCommitBulletsForRange(range);
  if (bullets.length === 0) {
    console.log('CHANGELOG.md unchanged: no commit subjects found for unpushed commits.');
    return false;
  }

  const changelog = readChangelog();
  const { preamble, sections } = splitChangelogSections(changelog);
  const nextSections = upsertSection(sections, '## Unreleased', bullets.join('\n'));
  const nextContent = renderSections(preamble, nextSections);
  return writeIfChanged(
    nextContent,
    'CHANGELOG.md unchanged: unreleased section already matches unpushed commits.',
    'Updated CHANGELOG.md from unpushed commits.'
  );
}

function prepareRelease(tagName) {
  syncUnreleasedFromUnpushedCommits();

  const changelog = readChangelog();
  const { preamble, sections } = splitChangelogSections(changelog);
  const unreleasedBody = getSectionBody(sections, '## Unreleased');
  const releaseHeading = `## ${tagName}`;
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

  let nextSections = upsertSection(sections, '## Unreleased', '- No unreleased changes yet.');
  nextSections = upsertSection(nextSections, releaseHeading, releaseBody, '## Unreleased');
  const nextContent = renderSections(preamble, nextSections);

  return writeIfChanged(
    nextContent,
    `CHANGELOG.md already prepared for ${tagName}.`,
    `Prepared CHANGELOG.md for ${tagName}.`
  );
}

const mode = process.argv[2];
const arg = process.argv[3];

if (mode === '--sync-unreleased') {
  syncUnreleasedFromUnpushedCommits();
} else if (mode === '--prepare-release') {
  if (!arg) {
    console.error('Usage: node scripts/sync-changelog.mjs --prepare-release vX.Y.Z');
    process.exit(1);
  }
  prepareRelease(arg);
} else {
  console.error('Usage: node scripts/sync-changelog.mjs --sync-unreleased | --prepare-release vX.Y.Z');
  process.exit(1);
}
