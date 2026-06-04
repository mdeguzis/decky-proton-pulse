import { describe, it, expect } from 'vitest';
import { buildVersionOptions } from './compatToolVersions';

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
      { value: 'Proton-GE-Latest', displayName: 'Proton-GE-Latest', installed: true, managed: true },
    ]);
  });

  it('emits the CachyOS latest slot with its own label, not collapsed to GE', () => {
    const opts = buildVersionOptions([], [
      tool({ directory_name: 'Proton-CachyOS-Latest', display_name: 'Proton-CachyOS-Latest', internal_name: 'proton-cachyos', tool_id: 'proton-cachyos', managed_slot: 'latest' }),
    ]);
    expect(opts).toEqual([
      { value: 'Proton-CachyOS-Latest', displayName: 'Proton-CachyOS-Latest', installed: true, managed: true },
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
