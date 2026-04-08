import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(import.meta.dirname, '..');
const version = fs.readFileSync(path.join(repoRoot, 'VERSION'), 'utf8').trim();
const changelog = fs.readFileSync(path.join(repoRoot, 'CHANGELOG.md'), 'utf8');

const heading = `## v${version}`;
const start = changelog.indexOf(heading);

if (start === -1) {
  console.error(`Could not find ${heading} in CHANGELOG.md`);
  process.exit(1);
}

const afterStart = changelog.slice(start + heading.length);
const nextHeadingMatch = afterStart.match(/\n##\s+v[^\n]+\n/);
const section = nextHeadingMatch
  ? afterStart.slice(0, nextHeadingMatch.index)
  : afterStart;

const notes = [`Proton Pulse v${version}`, '', ...section.trim().split('\n')].join('\n').trim() + '\n';
process.stdout.write(notes);
