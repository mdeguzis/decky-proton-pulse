import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const versionPath = path.join(repoRoot, 'VERSION');
const packageJsonPath = path.join(repoRoot, 'package.json');
const pyprojectPath = path.join(repoRoot, 'pyproject.toml');

const version = fs.readFileSync(versionPath, 'utf8').trim();

if (!/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(version)) {
  throw new Error(`Invalid VERSION value: ${version}`);
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
packageJson.version = version;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

const pyproject = fs.readFileSync(pyprojectPath, 'utf8');
if (!/^version = "[^"]+"$/m.test(pyproject)) {
  throw new Error('Could not find project.version in pyproject.toml');
}
const updatedPyproject = pyproject.replace(
  /^version = "[^"]+"$/m,
  `version = "${version}"`,
);

fs.writeFileSync(pyprojectPath, updatedPyproject);
console.log(`Synchronized version ${version} to package.json and pyproject.toml`);
