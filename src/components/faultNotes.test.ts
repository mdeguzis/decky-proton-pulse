/**
 * Per-fault free-text notes in the Native Pulse report modal.
 *
 * The plugin asked the same eight fault questions as the web form but offered
 * nowhere to say WHAT broke, so a plugin report could only ever record
 * "graphical faults: yes". The web form reveals an optional notes box when a
 * fault is answered yes and ships it as `${faultKey}Notes` in form_responses.
 *
 * There is no component test harness here (no *.test.tsx in the repo), so this
 * pins the wiring at source level: the render condition, the key shape the
 * backend and web share, and the clear-on-"no" rule.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, test, expect } from 'vitest';

import { FAULT_KEYS } from '../lib/scoring';

const SRC = readFileSync(join(__dirname, 'NativePulseReportModal.tsx'), 'utf8');
const I18N = readFileSync(join(__dirname, '..', 'lib', 'i18n.ts'), 'utf8');

describe('per-fault notes', () => {
  test('the notes field renders only when the fault is answered yes', () => {
    // YesNo is 'yes' | 'no', not a boolean -- comparing to true silently never
    // matched and tsc caught it as a string/boolean overlap error.
    expect(SRC).toContain("faults[key] === 'yes' && (");
  });

  test('notes ship under the same key shape the web form uses', () => {
    // `${faultKey}Notes`, so both clients land in one column and the game page
    // renders them identically.
    expect(SRC).toContain('`${k}Notes`');
  });

  test('empty notes serialize as null, not an empty string', () => {
    // Matches the web, and keeps "left blank" distinct from "typed nothing".
    expect(SRC).toMatch(/faultNotes\[k\] \?\? ''\)\.trim\(\) \|\| null/);
  });

  test('answering no clears any note already typed', () => {
    // Otherwise the report ships a description of a fault the reporter then
    // said they did not hit.
    expect(SRC).toContain("if (v !== 'yes') setFaultNotes");
  });

  test('the field is optional -- it is never added to the required checks', () => {
    const validation = SRC.slice(SRC.indexOf('const handleSubmit'), SRC.indexOf('const formResponses'));
    expect(validation).not.toContain('faultNotes');
  });

  test('notes survive a draft save and restore', () => {
    expect(SRC).toMatch(/summary, notes,\s*\n\s*faultNotes,/);
    expect(SRC).toContain('if (d.faultNotes && typeof d.faultNotes === \'object\')');
  });

  test('every fault key gets a notes counterpart', () => {
    // The notes are generated from FAULT_KEYS, so the two lists cannot drift.
    expect(FAULT_KEYS.length).toBeGreaterThanOrEqual(8);
    expect(SRC).toMatch(/FAULT_KEYS\.map\(k => \[`\$\{k\}Notes`/);
  });

  test('the label and description are translatable, not hardcoded', () => {
    expect(SRC).toContain('reportFormFaultNotesLabel');
    expect(SRC).toContain('reportFormFaultNotesDescription');
    expect(I18N).toContain('reportFormFaultNotesLabel: () =>');
    expect(I18N).toContain('reportFormFaultNotesDescription: () =>');
  });
});
