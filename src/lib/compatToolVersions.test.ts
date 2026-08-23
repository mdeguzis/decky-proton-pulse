import { describe, it, expect } from 'vitest';
import {
  buildVersionOptions,
  compatToolTypeForProtonKind,
  formatReportVersion,
  resolveReportVersion,
} from './compatToolVersions';

const tool = (over: Record<string, unknown>) => ({
  directory_name: 'X',
  display_name: 'X',
  internal_name: 'X',
  path: '',
  source: 'custom',
  tool_id: null,
  managed_slot: null,
  latest_tag: null,
  ...over,
});

describe('buildVersionOptions', () => {
  it('emits the GE latest slot as its own installed option', () => {
    const opts = buildVersionOptions([], [
      tool({ directory_name: 'Proton-GE-Latest', display_name: 'Proton-GE-Latest', internal_name: 'Proton-GE-Latest', tool_id: 'proton-ge', managed_slot: 'latest' }),
    ]);
    expect(opts).toEqual([
      { value: 'Proton-GE-Latest', displayName: 'Proton-GE-Latest', installed: true, managed: true, resolvedTarget: null },
    ]);
  });

  it('emits the CachyOS latest slot with its own label, not collapsed to GE', () => {
    const opts = buildVersionOptions([], [
      tool({ directory_name: 'Proton-CachyOS-Latest', display_name: 'Proton-CachyOS-Latest', internal_name: 'proton-cachyos', tool_id: 'proton-cachyos', managed_slot: 'latest' }),
    ]);
    expect(opts).toEqual([
      { value: 'Proton-CachyOS-Latest', displayName: 'Proton-CachyOS-Latest', installed: true, managed: true, resolvedTarget: null },
    ]);
  });

  it('keeps both latest slots when GE and CachyOS are installed', () => {
    const opts = buildVersionOptions([], [
      tool({ directory_name: 'Proton-GE-Latest', display_name: 'Proton-GE-Latest', internal_name: 'Proton-GE-Latest', tool_id: 'proton-ge', managed_slot: 'latest' }),
      tool({ directory_name: 'Proton-CachyOS-Latest', display_name: 'Proton-CachyOS-Latest', internal_name: 'proton-cachyos', tool_id: 'proton-cachyos', managed_slot: 'latest' }),
    ]);
    expect(opts.map((o) => o.value).sort()).toEqual(['Proton-CachyOS-Latest', 'Proton-GE-Latest']);
    expect(opts.every((o) => o.installed && o.managed)).toBe(true);
  });

  it('lists a versioned custom tool that is not a latest slot', () => {
    const opts = buildVersionOptions([], [
      tool({ directory_name: 'GE-Proton9-20', display_name: 'GE-Proton9-20', internal_name: 'GE-Proton9-20', tool_id: 'proton-ge', managed_slot: 'versioned' }),
    ]);
    expect(opts).toEqual([
      { value: 'GE-Proton9-20', displayName: 'GE-Proton9-20', installed: true, managed: false },
    ]);
  });

  it('sorts installed tools above not-installed releases', () => {
    const opts = buildVersionOptions(
      [{ tag_name: 'GE-Proton10-1' }],
      [tool({ directory_name: 'Proton-CachyOS-Latest', display_name: 'Proton-CachyOS-Latest', internal_name: 'proton-cachyos', tool_id: 'proton-cachyos', managed_slot: 'latest' })],
    );
    expect(opts[0].installed).toBe(true);
    expect(opts[opts.length - 1].installed).toBe(false);
  });
});

import { versionOptionsForType } from './compatToolVersions';

const geManagerState = {
  releases: [{ tag_name: 'GE-Proton10-1' }],
  installed_tools: [
    tool({ directory_name: 'Proton-GE-Latest', display_name: 'Proton-GE-Latest', internal_name: 'Proton-GE-Latest', tool_id: 'proton-ge', managed_slot: 'latest' }),
    tool({ directory_name: 'Proton 9.0 (Beta)', display_name: 'Proton 9.0 (Beta)', internal_name: 'Proton 9.0 (Beta)', tool_id: null, managed_slot: null }),
  ],
} as any;

const cachyManagerState = {
  releases: [{ tag_name: 'proton-cachyos-10.0' }],
  installed_tools: [
    tool({ directory_name: 'Proton-CachyOS-Latest', display_name: 'Proton-CachyOS-Latest', internal_name: 'proton-cachyos', tool_id: 'proton-cachyos', managed_slot: 'latest' }),
  ],
} as any;

describe('versionOptionsForType', () => {
  it('all: includes valve and managed families together', () => {
    const values = versionOptionsForType('all', geManagerState, null).map((o) => o.value);
    expect(values).toContain('Proton-GE-Latest');
    expect(values).toContain('Proton 9.0 (Beta)');
  });

  it('proton-ge: excludes valve/other tools', () => {
    const values = versionOptionsForType('proton-ge', geManagerState, null).map((o) => o.value);
    expect(values).toContain('Proton-GE-Latest');
    expect(values).not.toContain('Proton 9.0 (Beta)');
  });

  it('proton-cachyos: returns empty until cachy state is loaded', () => {
    expect(versionOptionsForType('proton-cachyos', geManagerState, null)).toEqual([]);
  });

  it('proton-cachyos: lists cachy installed + cachy releases when loaded', () => {
    const values = versionOptionsForType('proton-cachyos', geManagerState, cachyManagerState).map((o) => o.value);
    expect(values).toContain('Proton-CachyOS-Latest');
    expect(values).toContain('proton-cachyos-10.0');
  });

  it('valve: returns only installed tools whose source is valve', () => {
    const stateWithValve = {
      releases: [{ tag_name: 'GE-Proton10-1' }],
      installed_tools: [
        tool({ directory_name: 'Proton 9.0 (Beta)', display_name: 'Proton 9.0 (Beta)', internal_name: 'proton_9', source: 'valve' }),
        tool({ directory_name: 'Proton Experimental', display_name: 'Proton Experimental', internal_name: 'proton_experimental', source: 'valve' }),
        tool({ directory_name: 'GE-Proton10-1', display_name: 'GE-Proton10-1', internal_name: 'GE-Proton10-1', source: 'custom', tool_id: 'proton-ge' }),
      ],
    } as any;
    const opts = versionOptionsForType('valve', stateWithValve, null);
    const displayNames = opts.map((o) => o.displayName);
    expect(displayNames).toContain('Proton 9.0 (Beta)');
    expect(displayNames).toContain('Proton Experimental');
    expect(displayNames).not.toContain('GE-Proton10-1');
    expect(opts.every((o) => o.installed)).toBe(true);
  });
});

describe('rolling slot target resolution (#121)', () => {
  const slot = (over: Record<string, unknown> = {}) => tool({
    directory_name: 'Proton-GE-Latest',
    display_name: 'Proton-GE-Latest',
    internal_name: 'Proton-GE-Latest',
    tool_id: 'proton-ge',
    managed_slot: 'latest',
    ...over,
  });

  it('labels a latest slot with the versioned build it points at', () => {
    const [opt] = buildVersionOptions([], [slot({ current_target_name: 'GE-Proton11-1' })]);
    expect(opt.displayName).toBe('Proton-GE-Latest (GE-Proton11-1)');
    expect(opt.resolvedTarget).toBe('GE-Proton11-1');
    // The value stays the slot directory: it is what a launch option needs.
    expect(opt.value).toBe('Proton-GE-Latest');
  });

  it('falls back to latest_tag when the on-disk marker is missing', () => {
    const [opt] = buildVersionOptions([], [slot({ latest_tag: 'GE-Proton10-4' })]);
    expect(opt.resolvedTarget).toBe('GE-Proton10-4');
    expect(opt.displayName).toBe('Proton-GE-Latest (GE-Proton10-4)');
  });

  it('prefers the on-disk marker over the tag the manager last installed', () => {
    const [opt] = buildVersionOptions([], [
      slot({ current_target_name: 'GE-Proton11-1', latest_tag: 'GE-Proton10-4' }),
    ]);
    expect(opt.resolvedTarget).toBe('GE-Proton11-1');
  });

  it('leaves the label alone when nothing identifies the target', () => {
    const [opt] = buildVersionOptions([], [slot()]);
    expect(opt.displayName).toBe('Proton-GE-Latest');
    expect(opt.resolvedTarget).toBeNull();
  });
});

describe('formatReportVersion', () => {
  const opt = (over: Record<string, unknown> = {}) => ({
    value: 'Proton-GE-Latest',
    displayName: 'Proton-GE-Latest',
    installed: true,
    managed: true,
    resolvedTarget: 'GE-Proton11-1',
    ...over,
  });

  it('records the slot and the build it resolved to', () => {
    expect(formatReportVersion(opt())).toBe('Proton-GE-Latest (GE-Proton11-1)');
  });

  it('passes a plain versioned build through untouched', () => {
    expect(formatReportVersion(opt({ value: 'GE-Proton9-20', resolvedTarget: null })))
      .toBe('GE-Proton9-20');
  });

  it('does not nest a second set of parens on an already-resolved value', () => {
    expect(formatReportVersion(opt({ value: 'Proton-GE-Latest (GE-Proton11-1)' })))
      .toBe('Proton-GE-Latest (GE-Proton11-1)');
  });

  it('does not repeat itself when the slot already names its own target', () => {
    expect(formatReportVersion(opt({ value: 'GE-Proton11-1' }))).toBe('GE-Proton11-1');
  });

  it('returns empty string for no option', () => {
    expect(formatReportVersion(null)).toBe('');
  });
});

describe('resolveReportVersion', () => {
  const options = buildVersionOptions([], [
    tool({
      directory_name: 'Proton-GE-Latest',
      display_name: 'Proton-GE-Latest',
      internal_name: 'Proton-GE-Latest',
      tool_id: 'proton-ge',
      managed_slot: 'latest',
      current_target_name: 'GE-Proton11-1',
    }),
  ]);

  it('upgrades a bare slot name seeded from launch options', () => {
    expect(resolveReportVersion('Proton-GE-Latest', options))
      .toBe('Proton-GE-Latest (GE-Proton11-1)');
  });

  it('matches the slot case-insensitively', () => {
    expect(resolveReportVersion('proton-ge-latest', options))
      .toBe('Proton-GE-Latest (GE-Proton11-1)');
  });

  it('leaves an unknown version alone', () => {
    expect(resolveReportVersion('Proton 9.0-4', options)).toBe('Proton 9.0-4');
  });

  it('leaves an already-resolved value alone', () => {
    expect(resolveReportVersion('Proton-GE-Latest (GE-Proton10-4)', options))
      .toBe('Proton-GE-Latest (GE-Proton10-4)');
  });
});

describe('compatToolTypeForProtonKind', () => {
  it('maps each managed family onto its picker filter', () => {
    expect(compatToolTypeForProtonKind('valve')).toBe('valve');
    expect(compatToolTypeForProtonKind('proton-ge')).toBe('proton-ge');
    expect(compatToolTypeForProtonKind('proton-cachyos')).toBe('proton-cachyos');
  });

  it('has no list for answers a version dropdown cannot serve', () => {
    // native has no Proton at all, notListed is the escape hatch for builds we
    // do not manage. Both must fall through to the free-text field.
    expect(compatToolTypeForProtonKind('native')).toBeNull();
    expect(compatToolTypeForProtonKind('notListed')).toBeNull();
    expect(compatToolTypeForProtonKind(null)).toBeNull();
  });
});
