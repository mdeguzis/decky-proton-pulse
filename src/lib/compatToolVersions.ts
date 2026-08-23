import { formatProtonLabel } from './reportFormatters';
import type { CompatToolId, InstalledCompatTool, ProtonGeManagerState } from '../types';

export interface VersionOption {
  value: string;
  displayName: string;
  installed: boolean;
  managed: boolean;
  // Rolling "latest" slots only: the versioned build the slot currently
  // points at (e.g. 'GE-Proton11-1'). Null for every other option. Reports
  // record `slot (target)` so a year-old report still says which build it
  // actually ran on -- see formatReportVersion (#121).
  resolvedTarget?: string | null;
}

// Structural subset of InstalledCompatTool that the builder actually reads, so
// callers and tests can pass partial fixtures without every field.
type InstalledToolLike =
  Pick<InstalledCompatTool, 'directory_name' | 'display_name' | 'internal_name'> &
  Partial<Pick<InstalledCompatTool, 'managed_slot' | 'tool_id' | 'latest_tag' | 'current_target_name'>>;

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
      const base = t.display_name || t.directory_name;
      // current_target_name is the marker-file basename the slot symlinks
      // point at; latest_tag is the release tag the manager last installed
      // into it. Either identifies the real build, marker first because it
      // reflects what is on disk right now rather than what we intended.
      const resolvedTarget = (t.current_target_name || t.latest_tag || '').trim() || null;
      return {
        value: t.directory_name,
        displayName: resolvedTarget ? `${base} (${resolvedTarget})` : base,
        installed: true,
        managed: true,
        resolvedTarget,
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

// --- Report version strings (#121) -------------------------------------

/**
 * The version string a report should record for a picked option.
 *
 * Rolling slots are the whole reason this exists. 'Proton-GE-Latest' is a
 * moving target: the slot that ran a report in March is a different build by
 * June, so recording the slot name alone makes the report unreproducible.
 * Recording `Proton-GE-Latest (GE-Proton11-1)` keeps both the thing the user
 * selected and the build it resolved to at submit time.
 *
 * Non-slot options pass through untouched.
 */
export function formatReportVersion(option: VersionOption | null | undefined): string {
  if (!option) return '';
  const target = (option.resolvedTarget ?? '').trim();
  if (!target) return option.value;
  // Already parenthesized (a restored draft, or an option whose displayName
  // was fed back in). Do not nest a second set of parens.
  if (option.value.includes('(')) return option.value;
  if (option.value.trim().toLowerCase() === target.toLowerCase()) return option.value;
  return `${option.value} (${target})`;
}

/**
 * Resolve a bare rolling-slot name to its `slot (target)` form.
 *
 * Used when the report modal is seeded from a game's existing launch options,
 * which carry the raw slot directory name and nothing about what it points at.
 * Returns `raw` unchanged when it is not a known slot.
 */
export function resolveReportVersion(raw: string, options: VersionOption[]): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed.includes('(')) return trimmed;
  const match = options.find((o) => o.value.toLowerCase() === trimmed.toLowerCase());
  return match ? formatReportVersion(match) : trimmed;
}

/**
 * Map a Submit Report "Proton type" answer onto the compat-tool filter the
 * version picker uses.
 *
 * 'native' has no Proton version at all and 'notListed' is the escape hatch
 * for builds we do not manage, so both return null: the caller shows free
 * text only rather than a dropdown that could not contain the answer.
 */
export function compatToolTypeForProtonKind(kind: string | null | undefined): CompatToolType | null {
  switch (kind) {
    case 'valve':          return 'valve';
    case 'proton-ge':      return 'proton-ge';
    case 'proton-cachyos': return 'proton-cachyos';
    default:               return null;
  }
}
