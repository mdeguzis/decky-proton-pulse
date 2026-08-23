import { describe, it, expect } from 'vitest';
import { NOTE_PHRASES, appendNotePhrase, noteHasPhrase } from './notePhrases';

describe('appendNotePhrase', () => {
  it('starts an empty note with one terminated sentence', () => {
    expect(appendNotePhrase('', 'No stuttering')).toBe('No stuttering.');
  });

  it('chains taps into a readable sentence list', () => {
    let note = appendNotePhrase('', 'No stuttering');
    note = appendNotePhrase(note, 'Audio worked correctly');
    expect(note).toBe('No stuttering. Audio worked correctly.');
  });

  it('terminates a sentence the user typed without a period', () => {
    expect(appendNotePhrase('Ran fine on the OLED', 'No stuttering'))
      .toBe('Ran fine on the OLED. No stuttering.');
  });

  it('does not double up punctuation the user already typed', () => {
    expect(appendNotePhrase('Ran fine!', 'No stuttering'))
      .toBe('Ran fine! No stuttering.');
    expect(appendNotePhrase('Did it work?', 'No stuttering'))
      .toBe('Did it work? No stuttering.');
  });

  it('ignores a second tap on a phrase already in the note', () => {
    const note = appendNotePhrase('', 'No stuttering');
    expect(appendNotePhrase(note, 'No stuttering')).toBe(note);
  });

  it('matches an existing phrase regardless of case', () => {
    expect(appendNotePhrase('no stuttering at all.', 'No stuttering'))
      .toBe('no stuttering at all.');
  });

  it('ignores a blank phrase', () => {
    expect(appendNotePhrase('Ran fine.', '   ')).toBe('Ran fine.');
  });

  it('handles surrounding whitespace on the existing note', () => {
    expect(appendNotePhrase('  Ran fine.  ', 'No stuttering'))
      .toBe('Ran fine. No stuttering.');
  });
});

describe('noteHasPhrase', () => {
  it('reports a phrase that is present', () => {
    expect(noteHasPhrase('No stuttering. Audio worked correctly.', 'No stuttering')).toBe(true);
  });

  it('reports a phrase that is absent', () => {
    expect(noteHasPhrase('No stuttering.', 'Crashed occasionally')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(noteHasPhrase('NO STUTTERING.', 'No stuttering')).toBe(true);
  });

  it('says no for an empty note or an empty phrase', () => {
    expect(noteHasPhrase('', 'No stuttering')).toBe(false);
    expect(noteHasPhrase('No stuttering.', '')).toBe(false);
  });
});

describe('NOTE_PHRASES', () => {
  it('has unique ids and unique text', () => {
    expect(new Set(NOTE_PHRASES.map((p) => p.id)).size).toBe(NOTE_PHRASES.length);
    expect(new Set(NOTE_PHRASES.map((p) => p.text)).size).toBe(NOTE_PHRASES.length);
  });

  it('carries no trailing punctuation -- appendNotePhrase adds it', () => {
    for (const p of NOTE_PHRASES) expect(p.text).not.toMatch(/[.!?]$/);
  });

  it('has no phrase that is a substring of another', () => {
    // A substring would make noteHasPhrase light up the wrong chip and block
    // the longer phrase from ever being added.
    for (const a of NOTE_PHRASES) {
      for (const b of NOTE_PHRASES) {
        if (a.id === b.id) continue;
        expect(b.text.toLowerCase()).not.toContain(a.text.toLowerCase());
      }
    }
  });

  it('clears the 10 char minimum the notes field enforces with one tap', () => {
    for (const p of NOTE_PHRASES) {
      expect(appendNotePhrase('', p.text).trim().length).toBeGreaterThanOrEqual(10);
    }
  });
});
