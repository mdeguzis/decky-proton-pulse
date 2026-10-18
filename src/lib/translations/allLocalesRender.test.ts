// Every translation function in every locale must render to a non-empty
// string. A typo inside an interpolation, or a function that dereferences an
// argument it was not given, otherwise only shows up as a blank or crashed
// label on a Deck running that language.
//
// Locales are discovered from the directory listing rather than by hand: the
// hand-maintained list in vDeveloperGuard.test.ts silently missed the ten
// locales added after it (bg, da, el, es-419, fi, hu, no, pt, ro, sl).

import { readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

import type { TranslationTree } from '../i18n';

const localeFiles = readdirSync(new URL('.', import.meta.url))
  .filter((f) => f.endsWith('.ts') && f !== 'index.ts' && !f.endsWith('.test.ts'))
  .sort();

const locales = await Promise.all(
  localeFiles.map(async (file) => {
    const mod = (await import(`./${file}`)) as Record<string, TranslationTree>;
    return [file.replace(/\.ts$/, ''), Object.values(mod)[0]] as const;
  }),
);

type Leaf = { key: string; fn: (...args: unknown[]) => unknown };

function functionLeaves(node: unknown, prefix = ''): Leaf[] {
  if (typeof node === 'function') {
    return [{ key: prefix, fn: node as Leaf['fn'] }];
  }
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => functionLeaves(v, prefix ? `${prefix}.${k}` : k));
  }
  return [];
}

// Translators take counts, versions, names and error text. Numbers cover the
// plural branches (n === 1 and the else arm); strings cover callers that pass
// names or messages.
const ARG_SETS: unknown[][] = [
  [1, 1, 1, 1],
  [2, 3, 4, 5],
  ['Example', 'Example', 'Example', 'Example'],
];

describe('every locale renders every translation function', () => {
  test('discovers all locale files', () => {
    expect(locales.length).toBeGreaterThanOrEqual(28);
  });

  describe.each(locales)('%s', (_name, tree) => {
    const leaves = functionLeaves(tree);

    test('has translation functions', () => {
      expect(leaves.length).toBeGreaterThan(0);
    });

    test.each(leaves.map((leaf) => [leaf.key, leaf] as const))('%s', (_key, leaf) => {
      const rendered = ARG_SETS.map((args) => leaf.fn(...args));
      for (const out of rendered) {
        expect(typeof out).toBe('string');
        expect((out as string).trim()).not.toBe('');
        expect(out as string).not.toContain('undefined');
      }
    });
  });
});
