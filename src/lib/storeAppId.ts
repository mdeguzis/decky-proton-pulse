// src/lib/storeAppId.ts
// Which Steam store page is currently on screen?
//
// The in-client store lives at the /steamweb route and renders
// store.steampowered.com. It is its own browsing context, so we cannot read its
// DOM -- but we do not need to. All we want is the app id, and that is sitting
// in the URL of the element hosting it, which IS readable from Big Picture's
// document.
//
// Everything here is pure: a document (or a CDP target listing) in, an app id
// out. The polling and the hint UI live in src/patches/searchResultsHint.tsx.

/**
 * Router path fragment for the in-client store view.
 *
 * Matched as a substring, not a prefix. The real pathname is
 * `/routes/steamweb`, confirmed by reading `location.pathname` off
 * SharedJSContext with the store open -- a `startsWith('/steamweb')` check
 * never fires. Same reason isOnSearchRoute matches on 'search' rather than
 * anchoring.
 */
export const STORE_ROUTE = 'steamweb';

/** The store host, used both for the DOM scan and the URL allowlist. */
const STORE_HOST = 'store.steampowered.com';

/** Hosts whose /app/<id> pages we are willing to act on. */
const STORE_HOSTS = new Set([STORE_HOST]);

/**
 * The Steam app id from a store URL, or '' when the URL is not an app page.
 *
 * Deliberately strict on two axes, because this value decides which game the
 * plugin opens when the user presses Y:
 *
 *   host  matched against a parsed URL's hostname, never a substring search.
 *         A substring check treats
 *         https://evil.example.com/store.steampowered.com/app/620/ as a store
 *         page, because the real store's host appears in the attacker's PATH.
 *   id    a bare run of digits in the /app/<id> slot, rejected rather than
 *         sanitized if it is anything else.
 */
export function extractStoreAppId(url: string | null | undefined): string {
  if (!url) return '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return ''; // Not a URL at all.
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return '';
  if (!STORE_HOSTS.has(parsed.hostname.toLowerCase())) return '';
  const match = parsed.pathname.match(/^\/app\/(\d+)(?:\/|$)/);
  return match?.[1] ?? '';
}

/**
 * Find the element in Big Picture's document that displays the store URL.
 *
 * Verified on-device rather than assumed, because the obvious guess is wrong.
 * Big Picture's document contains NO webview or iframe element -- the store is
 * a separate top-level CEF target that Steam composites over the Big Picture
 * surface. What Big Picture DOES own is the browser chrome around it, and the
 * address display in that chrome is a plain leaf element whose textContent is
 * the live store URL. It tracks in-store navigation (confirmed: it changed from
 * app/620 to app/440 within three seconds of a navigation) and drops to
 * "https://store.steampowered.com/" on non-app pages.
 *
 * Matched by content, not by class. Steam's class names are build-hashed
 * (the address element was `_2aM-JaSHDzBfbg9FF6PrXq Panel Focusable`) and
 * would not survive a client update.
 *
 * The full scan is affordable because Big Picture's document is only the chrome
 * shell: 139 elements total, 84 of them divs, measured with the store open. The
 * store's own thousands of nodes live in the other target.
 */
export function findStoreUrlText(doc: Document | null | undefined): string {
  if (!doc) return '';
  let all: ArrayLike<Element>;
  try {
    all = doc.querySelectorAll('*');
  } catch {
    return '';
  }
  for (let i = 0; i < all.length; i++) {
    const el = all[i];
    if (el.children.length) continue; // leaves only: skip ancestors that merely contain the text
    const text = el.textContent ?? '';
    // Bounded so a stray node holding a huge blob cannot turn this into a
    // substring search over kilobytes on every poll.
    if (text.length < 12 || text.length > 300) continue;
    if (text.includes(STORE_HOST)) return text.trim();
  }
  return '';
}

/**
 * The app id of the store page currently on screen, or ''.
 *
 * '' covers both "not on an app page" (the store front, search, the cart) and
 * "could not tell", and the caller treats them the same way: no hint.
 */
export function storeAppIdFromDocument(doc: Document | null | undefined): string {
  return extractStoreAppId(findStoreUrlText(doc));
}

/** Is the Steam client currently showing the store view? */
export function isOnStoreRoute(pathname: string | null | undefined): boolean {
  return (pathname ?? '').includes(STORE_ROUTE);
}
