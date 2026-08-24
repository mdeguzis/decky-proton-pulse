// src/lib/steamFooterHint.ts
// Add an entry to Steam's own button-hint bar, the row that reads
// "X UNMUTE  Y FULL SCREEN  A PLAY  B BACK" along the bottom (#122).
//
// The entry is a CLONE of a hint Steam already rendered, with its glyph and
// label swapped. Cloning rather than rebuilding is the whole trick: Steam's
// class names are build-hashed (`_31JnnWnVv7U4VrSuta5yWO` for a label,
// `MbyhbxIetM7FOAmCQSW83` for an entry), so any stylesheet we wrote against
// them would break on the next client update. A clone inherits the real font,
// glyph size, spacing, and alignment for free, and keeps inheriting them.
//
// Verified on-device against the store view. The hint bar lives in Big
// Picture's document, which also paints OVER the store's browser view, so this
// works even though the store page itself is a separate CEF target we cannot
// touch. Structure found there:
//
//   bar   ._2JJDHoMl4ArT89aNzlYM3N
//    +- entry  .MbyhbxIetM7FOAmCQSW83
//        +- glyph wrapper ._3Jfd85nK4bKoNf_gCSTX6U
//        |   +- <img src="/steaminputglyphs/shared_button_b.svg">
//        +- label ._31JnnWnVv7U4VrSuta5yWO   "Back"
//
// Nothing above is hardcoded. The bar is located by finding a glyph image,
// which is language independent -- matching on the word "Back" would break in
// every locale except English.

import { logFrontendEvent } from './logger';

/** Steam Deck View button ("⧉", above the left stick). GamepadButton.SELECT. */
export const GLYPH_VIEW = '/steaminputglyphs/sd_button_view.svg';

interface FooterAnchor {
  bar: HTMLElement;
  template: HTMLElement;
}

/**
 * Locate the hint bar and a native entry to clone from.
 *
 * Found via a glyph image rather than by class or by label text: classes are
 * build-hashed and labels are localized, but every entry Steam renders carries
 * an <img> from /steaminputglyphs/. The Steam button itself uses an inline
 * <svg>, so it is skipped naturally by querying for img.
 */
export function findFooterAnchor(doc: Document | null | undefined): FooterAnchor | null {
  if (!doc) return null;
  let img: HTMLImageElement | null = null;
  try {
    img = doc.querySelector<HTMLImageElement>('img[src*="/steaminputglyphs/"]');
  } catch {
    return null;
  }
  // img -> glyph wrapper -> entry -> bar
  const wrapper = img?.parentElement ?? null;
  const template = wrapper?.parentElement ?? null;
  const bar = template?.parentElement ?? null;
  if (!bar || !template) return null;
  // An entry is glyph + label. Anything else means the DOM moved under us and
  // a clone would produce something misshapen.
  if (template.children.length < 2) return null;
  return { bar, template };
}

/**
 * Add (or update) our entry in the hint bar. Returns true when it is present.
 *
 * Idempotent: called on every poll tick, and only touches the DOM when
 * something actually changed. Re-adds itself if Steam re-rendered the bar and
 * dropped our node, which happens on navigation.
 */
export function ensureFooterHint(
  doc: Document | null | undefined,
  opts: { id: string; label: string; glyph: string },
): boolean {
  const existing = doc?.getElementById(opts.id) ?? null;
  if (existing) {
    // Steam keeps the bar but we may need to relabel (locale switch).
    const label = existing.lastElementChild;
    if (label && label.textContent !== opts.label) label.textContent = opts.label;
    return true;
  }

  const anchor = findFooterAnchor(doc);
  if (!anchor) return false;

  const clone = anchor.template.cloneNode(true) as HTMLElement;
  clone.id = opts.id;

  const img = clone.querySelector('img');
  if (img) {
    img.setAttribute('src', opts.glyph);
    img.setAttribute('aria-label', opts.label);
    // A cloned srcset would keep pulling the ORIGINAL glyph at 2x, so the
    // entry would show our label next to Steam's B button on a HiDPI panel.
    img.removeAttribute('srcset');
  }
  const label = clone.lastElementChild;
  if (label) label.textContent = opts.label;

  // Before the last entry: that slot is "Back"/cancel, which conventionally
  // stays rightmost in Steam's bar.
  const last = anchor.bar.lastElementChild;
  if (last) anchor.bar.insertBefore(clone, last);
  else anchor.bar.appendChild(clone);

  void logFrontendEvent('DEBUG', 'steamFooterHint: entry added', {
    id: opts.id,
    label: opts.label,
    glyph: opts.glyph,
    source: 'cloned native hint entry',
  });
  return true;
}

/** Take our entry back out. Safe to call when it was never added. */
export function removeFooterHint(doc: Document | null | undefined, id: string): void {
  const el = doc?.getElementById(id) ?? null;
  if (!el) return;
  try {
    el.remove();
  } catch { /* already detached */ }
  void logFrontendEvent('DEBUG', 'steamFooterHint: entry removed', { id });
}
