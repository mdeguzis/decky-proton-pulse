// Inject a stylesheet that lets a Proton Pulse toast wrap its body text
// instead of getting truncated by Steam's ShortTemplate.Body CSS
// (fixed height + text-overflow: ellipsis + line-clamp: 2).
//
// Why this file exists at all:
//   Inline styles on the body ReactNode do not beat Steam's Body class
//   because the inline style lives on a CHILD of Body, not on Body itself.
//   Steam's Body class caps the enclosing height, so anything inside gets
//   clipped no matter how many overrides we set on the child.
//
// How we defeat that:
//   Toaster's ToastData accepts a `contentClassName` prop that Decky
//   Loader joins onto the Content wrapper. Content is the DIRECT PARENT
//   of Body. So `.pp-toast-wrap [class*="Body"] { ... !important }` is a
//   descendant selector that lands on Steam's Body class regardless of
//   the runtime hash suffix Valve appends, and !important beats their
//   template rule.
//
// We use a broad [class*="Body"] match because Steam's actual class name
// is a hashed CSS module suffix (e.g. Body_abc123) that varies per Steam
// client build -- we cannot depend on the exact name.

export const PP_TOAST_WRAP_CLASS = 'pp-toast-wrap';

const STYLE_ID = 'pp-toast-wrap-styles';

/**
 * Idempotent: safe to call from every toast-emitting site. Guard is a DOM
 * lookup by id, not a module-level flag, so a page reload (or a test
 * clearing the head) reinstalls cleanly without relying on module state.
 */
export function ensureToastWrapStylesInstalled(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  // Descendant selector targets Steam's Body class (whatever hashed name it
  // has this Steam-client build) but scoped so only OUR toasts change. The
  // !important beats Valve's ShortTemplate rules.
  style.textContent = `
    .${PP_TOAST_WRAP_CLASS} [class*="Body"] {
      white-space: normal !important;
      overflow: visible !important;
      text-overflow: clip !important;
      height: auto !important;
      max-height: none !important;
      -webkit-line-clamp: unset !important;
      line-clamp: unset !important;
      line-height: 1.25 !important;
    }
    /* Also let Content itself grow so the popup renders taller instead of
       just clipping the freshly-unwrapped body against a fixed frame. */
    .${PP_TOAST_WRAP_CLASS} {
      height: auto !important;
      max-height: none !important;
    }
  `;
  document.head.appendChild(style);
}
