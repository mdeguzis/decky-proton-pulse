// Source-level guards for UI patterns that cannot work in Big Picture.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

function componentSources(): Array<{ file: string; text: string }> {
  const root = path.resolve(__dirname, '..');
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name)) {
        out.push({ file: path.relative(root, full), text: fs.readFileSync(full, 'utf8') });
      }
    }
  };
  walk(root);
  return out;
}

describe('gamepad guards', () => {
  it('uses Decky Dropdown, never a native <select> element', () => {
    // Big Picture cannot open the Chromium <select> popup with a gamepad: the
    // "Pick Installed Version" dialog was unusable until it moved to Dropdown.
    const offenders = componentSources()
      .filter(({ text }) => /<select[\s>]/.test(text.replace(/\/\/.*$/gm, '')))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
