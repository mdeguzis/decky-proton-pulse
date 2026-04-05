// src/lib/launchVars.test.ts
import { describe, it, expect } from 'vitest';
import {
  LAUNCH_VAR_CATALOG,
  buildLaunchOptions,
  parseLaunchOptions,
  type LaunchVarDef,
} from './launchVars';

describe('LAUNCH_VAR_CATALOG', () => {
  it('contains at least 20 variable definitions', () => {
    expect(LAUNCH_VAR_CATALOG.length).toBeGreaterThanOrEqual(20);
  });

  it('every entry has key, type, category, and description', () => {
    for (const def of LAUNCH_VAR_CATALOG) {
      expect(def.key).toBeTruthy();
      expect(['bool', 'enum']).toContain(def.type);
      expect(def.category).toBeTruthy();
      expect(def.description).toBeTruthy();
    }
  });

  it('enum entries have options array', () => {
    const enums = LAUNCH_VAR_CATALOG.filter((d) => d.type === 'enum');
    expect(enums.length).toBeGreaterThan(0);
    for (const def of enums) {
      expect(def.options).toBeDefined();
      expect(def.options!.length).toBeGreaterThan(0);
    }
  });
});

describe('buildLaunchOptions', () => {
  it('builds with proton version only', () => {
    const result = buildLaunchOptions('GE-Proton9-27', {});
    expect(result).toBe('PROTON_VERSION="GE-Proton9-27" %command%');
  });

  it('builds with vars and no proton version', () => {
    const result = buildLaunchOptions(null, { MANGOHUD: '1', DXVK_ASYNC: '1' });
    expect(result).toBe('MANGOHUD=1 DXVK_ASYNC=1 %command%');
  });

  it('builds with both proton version and vars', () => {
    const result = buildLaunchOptions('GE-Proton9-27', { MANGOHUD: '1' });
    expect(result).toBe('MANGOHUD=1 PROTON_VERSION="GE-Proton9-27" %command%');
  });

  it('returns just %command% when no version and no vars', () => {
    const result = buildLaunchOptions(null, {});
    expect(result).toBe('%command%');
  });

  it('quotes values containing spaces', () => {
    const result = buildLaunchOptions(null, { MANGOHUD_CONFIG: 'fps_only=1' });
    expect(result).toBe('MANGOHUD_CONFIG=fps_only=1 %command%');
  });
});

describe('parseLaunchOptions', () => {
  it('parses proton version from quoted PROTON_VERSION', () => {
    const result = parseLaunchOptions('PROTON_VERSION="GE-Proton9-27" %command%');
    expect(result.protonVersion).toBe('GE-Proton9-27');
    expect(result.vars).toEqual({});
  });

  it('parses env vars', () => {
    const result = parseLaunchOptions('MANGOHUD=1 DXVK_ASYNC=1 %command%');
    expect(result.protonVersion).toBeNull();
    expect(result.vars).toEqual({ MANGOHUD: '1', DXVK_ASYNC: '1' });
  });

  it('parses both proton version and vars', () => {
    const result = parseLaunchOptions('MANGOHUD=1 PROTON_VERSION="GE-Proton9-27" %command%');
    expect(result.protonVersion).toBe('GE-Proton9-27');
    expect(result.vars).toEqual({ MANGOHUD: '1' });
  });

  it('returns null protonVersion when not present', () => {
    const result = parseLaunchOptions('%command%');
    expect(result.protonVersion).toBeNull();
    expect(result.vars).toEqual({});
  });

  it('handles empty string', () => {
    const result = parseLaunchOptions('');
    expect(result.protonVersion).toBeNull();
    expect(result.vars).toEqual({});
  });

  it('round-trips with buildLaunchOptions', () => {
    const version = 'GE-Proton10-5';
    const vars = { MANGOHUD: '1', DXVK_ASYNC: '1' };
    const built = buildLaunchOptions(version, vars);
    const parsed = parseLaunchOptions(built);
    expect(parsed.protonVersion).toBe(version);
    expect(parsed.vars).toEqual(vars);
  });
});
