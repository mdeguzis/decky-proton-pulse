// @vitest-environment jsdom
//
// Real DOM here rather than the hand-rolled fakes used elsewhere in this repo:
// the implementation's whole point is cloneNode(true) on Steam's own markup,
// and a fake would end up testing the fake. jsdom is dev-only.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./logger', () => ({ logFrontendEvent: vi.fn().mockResolvedValue(true) }));

import { GLYPH_VIEW, ensureFooterHint, findFooterAnchor, removeFooterHint } from './steamFooterHint';

// Rebuilds the shape found on-device: a bar of entries, each entry being a
// glyph wrapper holding an <img> from /steaminputglyphs/ plus a label div.
// Class names are the real build-hashed ones to prove nothing matches on them.
function buildBar(labels: string[]): { doc: Document; bar: HTMLElement } {
  document.body.innerHTML = '';
  const bar = document.createElement('div');
  bar.className = '_2JJDHoMl4ArT89aNzlYM3N';
  for (const text of labels) {
    const entry = document.createElement('div');
    entry.className = 'MbyhbxIetM7FOAmCQSW83';
    const wrap = document.createElement('div');
    wrap.className = '_3Jfd85nK4bKoNf_gCSTX6U';
    const img = document.createElement('img');
    img.setAttribute('src', '/steaminputglyphs/shared_button_b.svg');
    img.setAttribute('srcset', '/steaminputglyphs/shared_button_b@2x.svg 2x');
    wrap.appendChild(img);
    const label = document.createElement('div');
    label.className = '_31JnnWnVv7U4VrSuta5yWO';
    label.textContent = text;
    entry.append(wrap, label);
    bar.appendChild(entry);
  }
  document.body.appendChild(bar);
  return { doc: document, bar };
}

const OPTS = { id: 'pp-test-hint', label: 'Proton', glyph: GLYPH_VIEW };

beforeEach(() => { document.body.innerHTML = ''; });

describe('findFooterAnchor', () => {
  it('finds the bar and a template entry via a glyph image', () => {
    const { bar } = buildBar(['Play', 'Back']);
    const anchor = findFooterAnchor(document);
    expect(anchor?.bar).toBe(bar);
    expect(anchor?.template.textContent).toBe('Play');
  });

  it('does not depend on label text, which is localized', () => {
    // Matching on the word "Back" would find nothing in any non-English locale.
    buildBar(['Spielen', 'Zurück']);
    expect(findFooterAnchor(document)).not.toBeNull();
  });

  it('ignores images that are not Steam input glyphs', () => {
    document.body.innerHTML = '<div><div><img src="/images/header.jpg"></div><div>x</div></div>';
    expect(findFooterAnchor(document)).toBeNull();
  });

  it('rejects a malformed entry that is missing its label', () => {
    // A one-child entry means the DOM moved under us; cloning it would emit
    // a misshapen hint rather than fail loudly.
    document.body.innerHTML =
      '<div><div class="entry"><div><img src="/steaminputglyphs/a.svg"></div></div></div>';
    expect(findFooterAnchor(document)).toBeNull();
  });

  it('returns null for no document', () => {
    expect(findFooterAnchor(null)).toBeNull();
    expect(findFooterAnchor(undefined)).toBeNull();
  });
});

describe('ensureFooterHint', () => {
  it('adds an entry carrying our glyph and label', () => {
    buildBar(['Play', 'Back']);
    expect(ensureFooterHint(document, OPTS)).toBe(true);
    const el = document.getElementById(OPTS.id)!;
    expect(el).not.toBeNull();
    expect(el.textContent).toBe('Proton');
    expect(el.querySelector('img')!.getAttribute('src')).toBe(GLYPH_VIEW);
  });

  it('inherits the native entry classes rather than inventing styling', () => {
    buildBar(['Play', 'Back']);
    ensureFooterHint(document, OPTS);
    const el = document.getElementById(OPTS.id)!;
    expect(el.className).toBe('MbyhbxIetM7FOAmCQSW83');
    expect(el.lastElementChild!.className).toBe('_31JnnWnVv7U4VrSuta5yWO');
  });

  it('drops the cloned srcset so a HiDPI panel cannot show the old glyph', () => {
    buildBar(['Play', 'Back']);
    ensureFooterHint(document, OPTS);
    expect(document.getElementById(OPTS.id)!.querySelector('img')!.hasAttribute('srcset')).toBe(false);
  });

  it('inserts before the last entry, keeping Back rightmost', () => {
    const { bar } = buildBar(['Play', 'Back']);
    ensureFooterHint(document, OPTS);
    expect([...bar.children].map((c) => c.textContent)).toEqual(['Play', 'Proton', 'Back']);
  });

  it('is idempotent -- repeated calls do not stack entries', () => {
    const { bar } = buildBar(['Play', 'Back']);
    for (let i = 0; i < 5; i++) ensureFooterHint(document, OPTS);
    expect(bar.querySelectorAll(`#${OPTS.id}`).length).toBe(1);
    expect(bar.children.length).toBe(3);
  });

  it('relabels in place when the language changes', () => {
    buildBar(['Play', 'Back']);
    ensureFooterHint(document, OPTS);
    ensureFooterHint(document, { ...OPTS, label: 'Protón' });
    expect(document.getElementById(OPTS.id)!.textContent).toBe('Protón');
  });

  it('re-adds itself after Steam rebuilds the bar', () => {
    // Steam re-renders the hint bar on navigation and takes our node with it.
    buildBar(['Play', 'Back']);
    ensureFooterHint(document, OPTS);
    buildBar(['Play', 'Back']);
    expect(document.getElementById(OPTS.id)).toBeNull();
    expect(ensureFooterHint(document, OPTS)).toBe(true);
    expect(document.getElementById(OPTS.id)).not.toBeNull();
  });

  it('reports false when there is no bar to join', () => {
    document.body.innerHTML = '<div>no hints here</div>';
    expect(ensureFooterHint(document, OPTS)).toBe(false);
    expect(document.getElementById(OPTS.id)).toBeNull();
  });
});

describe('removeFooterHint', () => {
  it('removes our entry and leaves the native ones alone', () => {
    const { bar } = buildBar(['Play', 'Back']);
    ensureFooterHint(document, OPTS);
    removeFooterHint(document, OPTS.id);
    expect(document.getElementById(OPTS.id)).toBeNull();
    expect([...bar.children].map((c) => c.textContent)).toEqual(['Play', 'Back']);
  });

  it('is safe when the entry was never added', () => {
    buildBar(['Play', 'Back']);
    expect(() => removeFooterHint(document, OPTS.id)).not.toThrow();
  });

  it('is safe with no document', () => {
    expect(() => removeFooterHint(null, OPTS.id)).not.toThrow();
  });
});
