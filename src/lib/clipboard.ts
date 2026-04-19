import { callable } from '@decky/api';
import { logFrontendEvent } from './logger';

// Three-stage clipboard strategy for Decky/SteamOS:
//
// 1) navigator.clipboard.writeText - the modern API. Works in secure contexts
//    and when the page has focus, but Gamescope-session overlays can trip
//    "Document is not focused" or permission policy rejections.
// 2) document.execCommand('copy') with a temporary textarea - the pre-async
//    clipboard API. More permissive in CEF since it only needs a user gesture,
//    which a button click qualifies as. Deprecated but still widely supported
// 3) backend copy_to_clipboard - shells out to wl-copy or xclip. SteamOS
//    Gamescope-session doesn't ship wl-clipboard by default, so this path
//    usually fails, but it's our last resort for desktop-mode users

const copyToClipboardBackend = callable<[text: string], boolean>('copy_to_clipboard');

function tryExecCommandCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const ta = document.createElement('textarea');
  ta.value = text;
  // Hide the element but keep it in the layout so execCommand can read from it
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.width = '1px';
  ta.style.height = '1px';
  ta.style.opacity = '0';
  ta.setAttribute('readonly', '');
  document.body.appendChild(ta);
  try {
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    return ok;
  } finally {
    document.body.removeChild(ta);
  }
}

export async function copyToClipboard(text: string): Promise<boolean> {
  // Stage 1: navigator.clipboard
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      void logFrontendEvent('DEBUG', 'Clipboard copy via navigator.clipboard');
      return true;
    }
    void logFrontendEvent('DEBUG', 'navigator.clipboard.writeText not available, falling through');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void logFrontendEvent('DEBUG', 'navigator.clipboard.writeText threw, falling through', { error: msg });
  }

  // Stage 2: execCommand
  try {
    if (tryExecCommandCopy(text)) {
      void logFrontendEvent('DEBUG', 'Clipboard copy via execCommand');
      return true;
    }
    void logFrontendEvent('DEBUG', 'execCommand copy returned false, falling through');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void logFrontendEvent('DEBUG', 'execCommand copy threw, falling through', { error: msg });
  }

  // Stage 3: backend (wl-copy/xclip)
  try {
    const ok = await copyToClipboardBackend(text);
    void logFrontendEvent(ok ? 'DEBUG' : 'WARNING', 'Clipboard copy via backend', { ok });
    return ok;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    void logFrontendEvent('ERROR', 'Clipboard backend threw', { error: msg });
    return false;
  }
}
