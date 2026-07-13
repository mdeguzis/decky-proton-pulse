import { formatProtonLabel } from './reportFormatters';
import type { CompatToolId, InstalledCompatTool, ProtonGeManagerState } from '../types';

export interface VersionOption {
  value: string;
  displayName: string;
  installed: boolean;
  managed: boolean;
}

// Structural subset of InstalledCompatTool that the builder actually reads, so
// callers and tests can pass partial fixtures without every field.
type InstalledToolLike =
  Pick<InstalledCompatTool, 'directory_name' | 'display_name' | 'internal_name'> &
  Partial<Pick<InstalledCompatTool, 'managed_slot' | 'tool_id'>>;

export function buildVersionOptions(
  releases: { tag_name: string }[],
  installedTools: InstalledToolLike[],
): VersionOption[] {
  const installedTagSet = new Set<string>();
  for (const tool of installedTools) {
    if (tool.internal_name) installedTagSet.add(tool.internal_name.toLowerCase());
    if (tool.directory_name) installedTagSet.add(tool.directory_name.toLowerCase());
  }
  const isInstalled = (tag: string) => installedTagSet.has(tag.toLowerCase());

  const releaseOptions: VersionOption[] = releases.map((r) => ({
    value: r.tag_name,
    displayName: formatProtonLabel(r.tag_name),
    installed: isInstalled(r.tag_name),
    managed: true,
  }));

  // One option per "latest" managed slot, labeled from the tool itself so each
  // family (Proton-GE-Latest, Proton-CachyOS-Latest, ...) shows distinctly.
  // The old code hardcoded a single Proton-GE-Latest entry, hiding CachyOS.
  const emittedDirs = new Set<string>();
  const latestOptions: VersionOption[] = installedTools
    .filter((t) => t.managed_slot === 'latest' || t.directory_name === 'Proton-GE-Latest')
    .map((t) => {
      emittedDirs.add(t.directory_name);
      return {
        value: t.directory_name,
        displayName: t.display_name || t.directory_name,
        installed: true,
        managed: true,
      };
    });

  const releaseTagSet = new Set(releases.map((r) => r.tag_name.toLowerCase()));
  const extraInstalled: VersionOption[] = installedTools
    .filter(
      (t) =>
        !releaseTagSet.has((t.internal_name || t.directory_name).toLowerCase()) &&
        !emittedDirs.has(t.directory_name),
    )
    .map((t) => ({
      value: t.internal_name || t.directory_name,
      displayName: t.display_name || t.directory_name,
      installed: true,
      managed: false,
    }));

  const combined = [...latestOptions, ...extraInstalled, ...releaseOptions];
  combined.sort((a, b) => (a.installed !== b.installed ? (a.installed ? -1 : 1) : 0));
  return combined;
}

// 'valve' is Steam's bundled Proton (not managed by us). It shows up in the
// picker so users can pick their currently-installed Valve versions when
// creating a config, matching the Valve Proton entry on the Submit Report
// screen (see src/lib/protonTypes.ts).
export type CompatToolType = 'all' | 'valve' | CompatToolId;

type ManagerStateLike = Pick<ProtonGeManagerState, 'releases' | 'installed_tools'>;

export function versionOptionsForType(
  type: CompatToolType,
  managerState: ManagerStateLike,
  cachyState: ManagerStateLike | null,
): VersionOption[] {
  if (type === 'all') {
    return buildVersionOptions(managerState.releases, managerState.installed_tools);
  }
  if (type === 'valve') {
    // Steam-provided Proton, source === 'valve' on the installed record.
    // No release list -- Valve Proton is only shown if it is installed.
    return buildVersionOptions(
      [],
      managerState.installed_tools.filter((t) => (t as { source?: string }).source === 'valve'),
    );
  }
  if (type === 'proton-ge') {
    return buildVersionOptions(
      managerState.releases,
      managerState.installed_tools.filter((t) => t.tool_id === 'proton-ge'),
    );
  }
  // proton-cachyos: needs the lazily-fetched cachy state
  if (!cachyState) return [];
  return buildVersionOptions(
    cachyState.releases,
    cachyState.installed_tools.filter((t) => t.tool_id === 'proton-cachyos'),
  );
}
