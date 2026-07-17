import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./notify', () => ({
  toaster: { toast: vi.fn() },
}));

import { toaster } from './notify';
import { maybeToastRollingSlotChange } from './rollingSlotToast';

describe('maybeToastRollingSlotChange', () => {
  beforeEach(() => vi.clearAllMocks());

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

  it('toasts a React-node restart message with style overrides + 6s duration', () => {
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
    // 6-second duration so users have time to read the full sentence
    // before the popup auto-dismisses.
    expect(call.duration).toBe(6000);
    // Body is a React element (not a plain string) so the inline style
    // can override Valve's ShortTemplate.Body single-line clip. The
    // wrapping <div> carries whiteSpace:normal + overflow:visible +
    // WebkitLineClamp:unset so the message wraps to as many lines as
    // it needs instead of getting ellipsis-clipped mid-word.
    expect(call.body).toEqual(expect.objectContaining({
      type: 'div',
      props: expect.objectContaining({
        style: expect.objectContaining({
          whiteSpace: 'normal',
          overflow: 'visible',
          textOverflow: 'clip',
          height: 'auto',
          maxHeight: 'none',
        }),
        children: 'Please restart Steam for changes to take effect.',
      }),
    }));
  });
});
