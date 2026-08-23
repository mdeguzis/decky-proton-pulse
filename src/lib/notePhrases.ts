// src/lib/notePhrases.ts
// Tap-to-add phrases for the Concluding Notes box on the Submit Report form
// (#121).
//
// Typing on a Deck means driving an on-screen keyboard with a thumbstick, so
// the notes field is the single biggest reason a report gets abandoned or
// filed with a useless one-word note. These behave like tags: tap one and its
// sentence is appended to whatever is already there, so a usable note is a few
// taps instead of a few minutes.
//
// Phrases stay short, factual, and independently true, because a reporter can
// pick any combination of them and the result has to read as a sentence list.
// Nothing here asserts a rating -- the rating comes from the fault answers.

export interface NotePhrase {
  /** Stable id, used as the React key and for i18n lookup. */
  id: string;
  /** Sentence added to the notes box, without trailing punctuation. */
  text: string;
}

export const NOTE_PHRASES: readonly NotePhrase[] = [
  { id: 'noStutter',      text: 'No stuttering' },
  { id: 'smooth60',       text: 'Held a steady 60fps' },
  { id: 'smooth30',       text: 'Held a steady 30fps' },
  { id: 'outOfTheBox',    text: 'Worked out of the box with no changes' },
  { id: 'neededLaunch',   text: 'Needed the launch options listed above' },
  { id: 'neededProtonGe', text: 'Needed Proton-GE instead of Valve Proton' },
  { id: 'goodBattery',    text: 'Battery life was good' },
  { id: 'heavyBattery',   text: 'Drains the battery quickly' },
  { id: 'audioFine',      text: 'Audio worked correctly' },
  { id: 'controllerFine', text: 'Controller worked without remapping' },
  { id: 'longLoads',      text: 'Load times were long' },
  { id: 'occasionalCrash',text: 'Crashed occasionally' },
  { id: 'cutscenesFine',  text: 'Cutscenes played correctly' },
  { id: 'launcherFine',   text: 'The launcher worked' },
];

/**
 * Append a phrase to an existing note, as one more sentence.
 *
 * Rules that keep the result readable no matter what order the user taps in:
 *   - a phrase already present (case-insensitively) is not added twice
 *   - the previous sentence gets a period if the user did not type one
 *   - the appended phrase always ends in a period, so the next tap has a
 *     clean boundary to append after
 *
 * Returns the note unchanged when the phrase is already there, so the caller
 * can rely on the return value alone.
 */
export function appendNotePhrase(current: string, phrase: string): string {
  const addition = (phrase ?? '').trim();
  if (!addition) return current ?? '';
  const existing = (current ?? '').trim();
  if (existing.toLowerCase().includes(addition.toLowerCase())) return current ?? '';
  const sentence = `${addition}.`;
  if (!existing) return sentence;
  // Terminal punctuation already there: just space and append.
  const terminated = /[.!?]$/.test(existing);
  return `${existing}${terminated ? '' : '.'} ${sentence}`;
}

/** Is this phrase already in the note? Drives the chip's selected styling. */
export function noteHasPhrase(current: string, phrase: string): boolean {
  const addition = (phrase ?? '').trim().toLowerCase();
  if (!addition) return false;
  return (current ?? '').toLowerCase().includes(addition);
}
