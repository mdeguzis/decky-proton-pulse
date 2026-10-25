// src/lib/launchVars.test.ts
import { describe, it, expect } from 'vitest';
import {
  LAUNCH_VAR_CATALOG,
  appendLaunchOptions,
  buildLaunchOptions,
  hasProtonVersion,
  stripProtonVersion,
  normalizeLaunchOptionsForComparison,
  parseLaunchOptions,
} from './launchVars';

describe('LAUNCH_VAR_CATALOG', () => {
  it('contains at least 20 variable definitions', () => {
    expect(LAUNCH_VAR_CATALOG.length).toBeGreaterThanOrEqual(20);
  });

  it('every entry has key, type, category, and description', () => {
    for (const def of LAUNCH_VAR_CATALOG) {
      expect(def.key).toBeTruthy();
      expect(['bool', 'enum', 'raw']).toContain(def.type);
      expect(def.category).toBeTruthy();
      expect(def.description).toBeTruthy();
    }
  });

  it('raw entries use OS-agnostic path syntax (no ~ expansion required by shell)', () => {
    const raws = LAUNCH_VAR_CATALOG.filter((d) => d.type === 'raw');
    for (const def of raws) {
      // raw wrapper keys should not contain KEY= style assignment
      expect(def.key).not.toContain('=');
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
  it('builds with vars before %command%', () => {
    const result = buildLaunchOptions({ MANGOHUD: '1', DXVK_ASYNC: '1' });
    expect(result).toBe('MANGOHUD=1 DXVK_ASYNC=1 %command%');
  });

  it('returns just %command% when there are no vars', () => {
    expect(buildLaunchOptions({})).toBe('%command%');
  });

  it('quotes values containing spaces', () => {
    const result = buildLaunchOptions({ MANGOHUD_CONFIG: 'fps_only=1' });
    expect(result).toBe('MANGOHUD_CONFIG=fps_only=1 %command%');
  });

  it('puts post-command toggle args after %command%', () => {
    const result = buildLaunchOptions({ MANGOHUD: '1' }, ['gamemoderun'], ['-log', '--trace']);
    expect(result).toBe('MANGOHUD=1 gamemoderun %command% -log --trace');
  });

  it('never writes PROTON_VERSION (#92: nothing at launch reads it)', () => {
    expect(buildLaunchOptions({ MANGOHUD: '1' }, ['gamemoderun'])).not.toContain('PROTON_VERSION');
  });
});

describe('stripProtonVersion (#92)', () => {
  it('removes quoted and bare PROTON_VERSION tokens', () => {
    expect(stripProtonVersion('PROTON_VERSION="GE-Proton10-1" %command%')).toBe('%command%');
    expect(stripProtonVersion('MANGOHUD=1 PROTON_VERSION=GE-Proton10-1 %command%')).toBe('MANGOHUD=1 %command%');
    expect(stripProtonVersion('PROTON_VERSION="a" PROTON_VERSION="b" %command%')).toBe('%command%');
  });

  it('leaves everything else exactly as written, quoted paths with spaces included', () => {
    const opts = '~/proton-launch %command% "/run/media/deck/My Games/roms/18wheelr.zip"';
    expect(stripProtonVersion(`PROTON_VERSION="GE-Proton10-1" ${opts}`)).toBe(opts);
    expect(stripProtonVersion('~/lsfg %command%')).toBe('~/lsfg %command%');
  });

  it('does not touch variables that only contain the word', () => {
    expect(stripProtonVersion('MY_PROTON_VERSION=1 %command%')).toBe('MY_PROTON_VERSION=1 %command%');
  });

  it('hasProtonVersion detects the token without false positives', () => {
    expect(hasProtonVersion('PROTON_VERSION="GE-Proton10-1" %command%')).toBe(true);
    expect(hasProtonVersion('~/lsfg %command%')).toBe(false);
    expect(hasProtonVersion('MY_PROTON_VERSION=1 %command%')).toBe(false);
    // stable across repeated calls (the regex is global)
    expect(hasProtonVersion('PROTON_VERSION=x %command%')).toBe(true);
    expect(hasProtonVersion('PROTON_VERSION=x %command%')).toBe(true);
  });
});

describe('parseLaunchOptions', () => {
  it('parses proton version from quoted PROTON_VERSION', () => {
    const result = parseLaunchOptions('PROTON_VERSION="GE-Proton9-27" %command%');
    expect(result.protonVersion).toBe('GE-Proton9-27');
    expect(result.vars).toEqual({});
    expect(result.postCommandArgs).toEqual([]);
  });

  it('parses env vars', () => {
    const result = parseLaunchOptions('MANGOHUD=1 DXVK_ASYNC=1 %command%');
    expect(result.protonVersion).toBeNull();
    expect(result.vars).toEqual({ MANGOHUD: '1', DXVK_ASYNC: '1' });
    expect(result.postCommandArgs).toEqual([]);
  });

  it('parses both proton version and vars', () => {
    const result = parseLaunchOptions('MANGOHUD=1 PROTON_VERSION="GE-Proton9-27" %command%');
    expect(result.protonVersion).toBe('GE-Proton9-27');
    expect(result.vars).toEqual({ MANGOHUD: '1' });
    expect(result.postCommandArgs).toEqual([]);
  });

  it('returns null protonVersion when not present', () => {
    const result = parseLaunchOptions('%command%');
    expect(result.protonVersion).toBeNull();
    expect(result.vars).toEqual({});
    expect(result.postCommandArgs).toEqual([]);
  });

  it('handles empty string', () => {
    const result = parseLaunchOptions('');
    expect(result.protonVersion).toBeNull();
    expect(result.vars).toEqual({});
    expect(result.postCommandArgs).toEqual([]);
  });

  it('round-trips with buildLaunchOptions', () => {
    const vars = { MANGOHUD: '1', DXVK_ASYNC: '1' };
    const built = buildLaunchOptions(vars, ['gamemoderun'], ['-log']);
    const parsed = parseLaunchOptions(built);
    expect(parsed.protonVersion).toBeNull();
    expect(parsed.vars).toEqual(vars);
    expect(parsed.rawArgs).toEqual(['gamemoderun']);
    expect(parsed.postCommandArgs).toEqual(['-log']);
  });
});

describe('launch option conflict helpers', () => {
  it('normalizes launch options for safe comparison', () => {
    expect(normalizeLaunchOptionsForComparison(' PROTON_LOG=1   %command% ')).toBe('PROTON_LOG=1');
    expect(normalizeLaunchOptionsForComparison('DXVK_ASYNC=1   MANGOHUD=1')).toBe('DXVK_ASYNC=1 MANGOHUD=1');
  });

  it('appends launch options while keeping a single %command% token', () => {
    expect(appendLaunchOptions('PROTON_LOG=1 %command%', 'MANGOHUD=1 %command%')).toBe(
      'PROTON_LOG=1 MANGOHUD=1 %command%',
    );
    expect(appendLaunchOptions('', 'PROTON_VERSION="GE-Proton10-1" %command%')).toBe('%command%');
    expect(appendLaunchOptions('', '')).toBe('%command%');
  });

  // #68 / #92: legacy PROTON_VERSION on either side is dropped, never duplicated
  it('drops PROTON_VERSION from both sides and preserves other vars', () => {
    const result = appendLaunchOptions(
      'PROTON_VERSION="GE-Proton9-20" PROTON_LOG=1 %command%',
      'PROTON_VERSION="GE-Proton10-1" %command%',
    );
    expect(result).toBe('PROTON_LOG=1 %command%');
  });

  it('overrides shared env vars with incoming values', () => {
    // user had MANGOHUD off, report turns it on - report wins
    const result = appendLaunchOptions('MANGOHUD=0 %command%', 'MANGOHUD=1 %command%');
    expect(result).toBe('MANGOHUD=1 %command%');
  });

  it('preserves user vars that arent in the incoming options', () => {
    // matches the issue text: "Non-runtime params from existing that arent in
    // incoming are preserved"
    const result = appendLaunchOptions(
      'MANGOHUD=1 PROTON_LOG=1 %command%',
      'PROTON_VERSION="GE-Proton10-1" %command%',
    );
    expect(result).toBe('MANGOHUD=1 PROTON_LOG=1 %command%');
  });

  it('dedupes wrappers like gamemoderun and adds new ones from incoming', () => {
    const result = appendLaunchOptions(
      'gamemoderun %command%',
      'gamemoderun mangohud %command%',
    );
    expect(result).toBe('gamemoderun mangohud %command%');
  });

  it('dedupes post-command args while merging new flags', () => {
    const result = appendLaunchOptions('%command% -log', '%command% -log -nojoy');
    expect(result).toBe('%command% -log -nojoy');
  });

  it('drops an existing PROTON_VERSION when merging', () => {
    const result = appendLaunchOptions(
      'PROTON_VERSION="GE-Proton9-20" %command%',
      'MANGOHUD=1 %command%',
    );
    expect(result).toBe('MANGOHUD=1 %command%');
  });
});
