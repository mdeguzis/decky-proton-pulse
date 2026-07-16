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

  it('toasts a short restart message when the symlink was updated', () => {
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
    // Kept intentionally short so the toast bar does not truncate.
    expect(call.body).toBe('Please restart Steam for changes to take effect.');
    expect(call.body.length).toBeLessThan(80);
  });
});
