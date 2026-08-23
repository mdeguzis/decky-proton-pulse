import { describe, it, expect } from 'vitest';
import {
  VR_HEADSETS,
  VR_RUNTIME_KEYS,
  normalizePlayMode,
  normalizeVrRuntime,
  vrFieldsForSubmission,
  vrRuntimeLabel,
} from './vr';

describe('normalizePlayMode', () => {
  it('accepts the canonical values', () => {
    expect(normalizePlayMode('flat')).toBe('flat');
    expect(normalizePlayMode('vr')).toBe('vr');
  });

  it('accepts the spellings a human or a legacy row might carry', () => {
    expect(normalizePlayMode('Flatscreen')).toBe('flat');
    expect(normalizePlayMode('  DESKTOP ')).toBe('flat');
    expect(normalizePlayMode('pancake')).toBe('flat');
    expect(normalizePlayMode('headset')).toBe('vr');
    expect(normalizePlayMode('Virtual Reality')).toBe('vr');
  });

  it('returns null for unknown input rather than guessing flatscreen', () => {
    // A legacy row predates the field entirely. Backfilling it as flat would
    // mislabel any VR report submitted before play_mode shipped.
    expect(normalizePlayMode(null)).toBeNull();
    expect(normalizePlayMode('')).toBeNull();
    expect(normalizePlayMode('   ')).toBeNull();
    expect(normalizePlayMode('couch')).toBeNull();
  });
});

describe('normalizeVrRuntime', () => {
  it('accepts every canonical key', () => {
    for (const key of VR_RUNTIME_KEYS) expect(normalizeVrRuntime(key)).toBe(key);
  });

  it('folds common spellings onto the canonical key', () => {
    expect(normalizeVrRuntime('Steam VR')).toBe('steamvr');
    expect(normalizeVrRuntime('SteamVR')).toBe('steamvr');
    expect(normalizeVrRuntime('WiVRn')).toBe('wivrn');
    expect(normalizeVrRuntime('ALVR')).toBe('alvr');
    expect(normalizeVrRuntime('Monado')).toBe('monado');
  });

  it('passes an unregistered but storable runtime through', () => {
    // A new OpenXR implementation lands every few months; dropping it would
    // lose real data over a stale list.
    expect(normalizeVrRuntime('some-new-runtime')).toBe('some-new-runtime');
  });

  it('rejects anything the DB CHECK constraint would reject', () => {
    expect(normalizeVrRuntime('Has Spaces')).toBeNull();
    expect(normalizeVrRuntime('under_score')).toBeNull();
    expect(normalizeVrRuntime('x'.repeat(33))).toBeNull();
    expect(normalizeVrRuntime('')).toBeNull();
    expect(normalizeVrRuntime(null)).toBeNull();
  });
});

describe('vrRuntimeLabel', () => {
  it('labels a known key', () => {
    expect(vrRuntimeLabel('steamvr')).toBe('SteamVR');
  });

  it('falls back to the raw key for an unregistered runtime', () => {
    expect(vrRuntimeLabel('some-new-runtime')).toBe('some-new-runtime');
  });

  it('says Unknown for nothing', () => {
    expect(vrRuntimeLabel(null)).toBe('Unknown');
  });
});

describe('vrFieldsForSubmission', () => {
  it('nulls the VR columns on a flatscreen report', () => {
    // Explicit nulls, not omitted keys: an edit from VR back to Flatscreen has
    // to CLEAR the old runtime, and a PATCH that omits a key leaves it be.
    expect(vrFieldsForSubmission('flat', 'steamvr', 'Valve Index')).toEqual({
      play_mode: 'flat', vr_runtime: null, vr_device: null,
    });
  });

  it('carries the runtime and headset on a VR report', () => {
    expect(vrFieldsForSubmission('vr', 'steamvr', 'Valve Index')).toEqual({
      play_mode: 'vr', vr_runtime: 'steamvr', vr_device: 'Valve Index',
    });
  });

  it('normalizes the runtime on the way out', () => {
    expect(vrFieldsForSubmission('vr', 'Steam VR', null).vr_runtime).toBe('steamvr');
  });

  it('caps the headset at the 64 char column bound', () => {
    const long = 'H'.repeat(200);
    expect(vrFieldsForSubmission('vr', 'steamvr', long).vr_device).toHaveLength(64);
  });

  it('treats a blank headset as not specified', () => {
    expect(vrFieldsForSubmission('vr', 'steamvr', '   ').vr_device).toBeNull();
  });

  it('leaves play_mode null when the reporter was never asked', () => {
    expect(vrFieldsForSubmission(null, null, null)).toEqual({
      play_mode: null, vr_runtime: null, vr_device: null,
    });
  });
});

describe('VR_HEADSETS', () => {
  it('has no duplicates', () => {
    expect(new Set(VR_HEADSETS).size).toBe(VR_HEADSETS.length);
  });

  it('stays within the vr_device column bound', () => {
    for (const h of VR_HEADSETS) expect(h.length).toBeLessThanOrEqual(64);
  });
});
