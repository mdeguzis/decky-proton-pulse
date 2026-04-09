import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const version = fs.readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim();
const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');

const heading = `## v${version}`;
const start = changelog.indexOf(heading);

function buildNotesFromSection(title, sectionText) {
  return [title, '', ...sectionText.trim().split('\n')].join('\n').trim() + '\n';
}

function getFallbackCommitNotes() {
  try {
    const latestTag = execSync('git describe --tags --abbrev=0', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const raw = execSync(`git log --format=%s ${latestTag}..HEAD`, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => `- ${line}`);
    if (lines.length > 0) {
      return lines;
    }
  } catch {
    // Fall through to the generic fallback below.
  }

  return [
    '- Release notes fallback was used because no matching CHANGELOG section was found.',
    '- Review the changelog and commit history before publishing publicly.',
  ];
}

if (start === -1) {
  const unreleasedHeading = '## Unreleased';
  const unreleasedStart = changelog.indexOf(unreleasedHeading);
  if (unreleasedStart !== -1) {
    const afterStart = changelog.slice(unreleasedStart + unreleasedHeading.length);
    const nextHeadingMatch = afterStart.match(/\n##\s+v[^\n]+\n/);
    const section = nextHeadingMatch
      ? afterStart.slice(0, nextHeadingMatch.index)
      : afterStart;
    console.error(`Warning: Could not find ${heading} in CHANGELOG.md; using ## Unreleased notes.`);
    process.stdout.write(buildNotesFromSection(`Proton Pulse v${version}`, section));
    process.exit(0);
  }

  console.error(`Warning: Could not find ${heading} in CHANGELOG.md; using commit history fallback.`);
  process.stdout.write(
    `${[`Proton Pulse v${version}`, '', ...getFallbackCommitNotes()].join('\n').trim()}\n`
  );
  process.exit(0);
}

const afterStart = changelog.slice(start + heading.length);
const nextHeadingMatch = afterStart.match(/\n##\s+v[^\n]+\n/);
const section = nextHeadingMatch
  ? afterStart.slice(0, nextHeadingMatch.index)
  : afterStart;

process.stdout.write(buildNotesFromSection(`Proton Pulse v${version}`, section));
