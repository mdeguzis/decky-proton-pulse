import { describe, it, expect, beforeEach, vi } from 'vitest';

// jsdom is not installed in this workspace, so shim just enough of the DOM
// API for the toast style-injection tests: getElementById returns whatever
// is in _styleTagsById, createElement returns a plain object with an id +
// textContent, head.appendChild registers by id. Cache and toast tests
// elsewhere in the repo take the same "stub what you need" approach.
const _styleTagsById: Record<string, { id: string; textContent: string }> = {};
vi.stubGlobal('document', {
  getElementById: (id: string) => _styleTagsById[id] ?? null,
  createElement: (_tag: string) => ({ id: '', textContent: '' }),
  head: {
    appendChild: (el: { id: string; textContent: string }) => {
      _styleTagsById[el.id] = el;
      return el;
    },
  },
  querySelectorAll: (sel: string) => {
    const m = sel.match(/^#(.+)$/);
    if (m && _styleTagsById[m[1]]) return [_styleTagsById[m[1]]];
    return [];
  },
});

vi.mock('./notify', () => ({
  toaster: { toast: vi.fn() },
}));

import { toaster } from './notify';
import { maybeToastRollingSlotChange } from './rollingSlotToast';
import { PP_TOAST_WRAP_CLASS } from './toastStyles';

describe('maybeToastRollingSlotChange', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fresh stylesheet-install state each test. The style-injection helper
    // guards on document.getElementById(styleId), so clearing our stub
    // registry is enough -- no module-level flag to reset.
    for (const k of Object.keys(_styleTagsById)) delete _styleTagsById[k];
  });

  it('returns false + no toast when install failed', () => {
    const shown = maybeToastRollingSlotChange({ success: false, message: 'bad' });
    expect(shown).toBe(false);
    expect(toaster.toast).not.toHaveBeenCalled();
  });

  it('returns false + no toast when there is no rolling_slot payload', () => {
    const shown = maybeToastRollingSlotChange({ success: true, message: 'ok' });
    expect(shown).toBe(false);
    expect(toaster.toast).not.toHaveBeenCalled();
  });

  it('returns false + no toast when rolling_slot did not change', () => {
    const shown = maybeToastRollingSlotChange({
      success: true, message: 'ok',
      rolling_slot: { ok: true, changed: false, slot: '/tmp/Proton-GE-Latest' },
    });
    expect(shown).toBe(false);
    expect(toaster.toast).not.toHaveBeenCalled();
  });

  it('returns false + no toast when rolling_slot check itself failed', () => {
    const shown = maybeToastRollingSlotChange({
      success: true, message: 'ok',
      rolling_slot: { ok: false, reason: 'slot-is-real-dir' },
    });
    expect(shown).toBe(false);
    expect(toaster.toast).not.toHaveBeenCalled();
  });

  it('toasts the restart message with contentClassName + 6s duration', () => {
    const shown = maybeToastRollingSlotChange({
      success: true, message: 'ok',
      rolling_slot: {
        ok: true, changed: true,
        slot: '/home/deck/.steam/steam/compatibilitytools.d/Proton-GE-Latest',
        target: '/.../GE-Proton10-19',
      },
    });
    expect(shown).toBe(true);
    expect(toaster.toast).toHaveBeenCalledTimes(1);
    const call = (toaster.toast as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.title).toBe('Proton Pulse');
    expect(call.body).toBe('Please restart Steam for changes to take effect.');
    // 6-second duration so users have time to read the full sentence
    // before the popup auto-dismisses.
    expect(call.duration).toBe(6000);
    // contentClassName scopes the wrap-CSS to this toast only. Steam's
    // ShortTemplate.Body is normally single-line with ellipsis; the
    // stylesheet from toastStyles.ts targets `.pp-toast-wrap [class*="Body"]`
    // and overrides those constraints with !important so the sentence
    // wraps to multiple lines instead of getting clipped.
    expect(call.contentClassName).toBe(PP_TOAST_WRAP_CLASS);
  });

  it('installs the wrap stylesheet before emitting the toast', () => {
    expect(document.getElementById('pp-toast-wrap-styles')).toBeNull();
    maybeToastRollingSlotChange({
      success: true, message: 'ok',
      rolling_slot: { ok: true, changed: true, slot: '/x', target: '/y' },
    });
    const styleEl = document.getElementById('pp-toast-wrap-styles');
    expect(styleEl).not.toBeNull();
    // Sanity: the scoped selector + !important overrides are what actually
    // defeat Steam's single-line clip. Regression guard so a future refactor
    // does not silently drop them.
    const css = styleEl?.textContent || '';
    expect(css).toContain(`.${PP_TOAST_WRAP_CLASS} [class*="Body"]`);
    expect(css).toContain('white-space: normal !important');
    expect(css).toContain('-webkit-line-clamp: unset !important');
    expect(css).toContain('max-height: none !important');
  });

  it('is idempotent: a second toast does not stack duplicate style tags', () => {
    maybeToastRollingSlotChange({
      success: true, message: 'ok',
      rolling_slot: { ok: true, changed: true, slot: '/x', target: '/y' },
    });
    maybeToastRollingSlotChange({
      success: true, message: 'ok',
      rolling_slot: { ok: true, changed: true, slot: '/x', target: '/y' },
    });
    expect(document.querySelectorAll('#pp-toast-wrap-styles').length).toBe(1);
  });
});
