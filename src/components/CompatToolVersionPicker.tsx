import { useMemo, useState } from 'react';
import { DropdownItem, SteamSpinner } from '@decky/ui';
import { COMPAT_TOOL_OPTIONS, type ProtonGeManagerState } from '../types';
import {
  versionOptionsForType,
  type CompatToolType,
  type VersionOption,
} from '../lib/compatToolVersions';
import { VersionOptionLabel } from './EditReportModal';
import { getCompatManagerState } from '../lib/compatTools';
import { logFrontendEvent } from '../lib/logger';
import { t } from '../lib/i18n';

interface CompatToolVersionPickerProps {
  // currently selected proton version value (directory name or tag)
  value: string;
  // called when the user picks a version; option is the chosen entry (if known)
  onChange: (version: string, option?: VersionOption) => void;
  // pre-fetched "all" + Proton-GE releases state from getProtonGeManagerState
  managerState: ProtonGeManagerState;
  // when set, shows the "installing <v>..." label and disables the version row
  installingVersion?: string | null;
}

export function CompatToolVersionPicker({
  value,
  onChange,
  managerState,
  installingVersion = null,
}: CompatToolVersionPickerProps) {
  const [selectedType, setSelectedType] = useState<CompatToolType>('all');
  const [cachyState, setCachyState] = useState<ProtonGeManagerState | null>(null);
  const [loadingCachy, setLoadingCachy] = useState(false);

  const typeOptions = [
    { data: 'all', label: t().detail.compatToolTypeAll ?? 'All' },
    ...COMPAT_TOOL_OPTIONS.map((o) => ({ data: o.id, label: o.label })),
  ];

  const handleTypeChange = (next: CompatToolType) => {
    setSelectedType(next);
    if (next === 'proton-cachyos' && !cachyState && !loadingCachy) {
      setLoadingCachy(true);
      getCompatManagerState('proton-cachyos', false)
        .then((state) => {
          setCachyState(state);
          void logFrontendEvent('DEBUG', 'CompatToolVersionPicker: loaded CachyOS state', {
            toolId: 'proton-cachyos',
            releases: state.releases.length,
            installed: state.installed_tools.length,
            source: 'getCompatManagerState',
          });
        })
        .catch((err) => {
          void logFrontendEvent('WARNING', 'CompatToolVersionPicker: failed to load CachyOS state', {
            toolId: 'proton-cachyos',
            error: err instanceof Error ? err.message : String(err),
          });
        })
        .finally(() => setLoadingCachy(false));
    }
  };

  const options = useMemo(
    () => versionOptionsForType(selectedType, managerState, cachyState),
    [selectedType, managerState, cachyState],
  );

  // keep the current value selectable even if it is not in the active list
  // (e.g. a custom version, or a value from a different family than the filter)
  const withCurrent = useMemo(() => {
    if (!value) return options;
    if (options.some((o) => o.value.toLowerCase() === value.toLowerCase())) return options;
    return [
      { value, displayName: value, installed: false, managed: /ge/i.test(value) },
      ...options,
    ];
  }, [options, value]);

  const versionDropdownOptions = [
    { data: '', label: t().configManager.protonVersionNone },
    ...withCurrent.map((opt) => ({
      data: opt.value,
      label: <VersionOptionLabel name={opt.displayName} installed={opt.installed} managed={opt.managed} />,
    })),
  ];

  return (
    <>
      <DropdownItem
        label={t().detail.compatToolType ?? 'Compatibility Tool Type'}
        rgOptions={typeOptions}
        selectedOption={selectedType}
        onChange={(opt) => handleTypeChange(opt.data as CompatToolType)}
      />
      {loadingCachy ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <SteamSpinner style={{ width: 16, height: 16 }} />
          <span style={{ fontSize: 11, color: '#7a9bb5' }}>{t().common.loading}</span>
        </div>
      ) : (
        <DropdownItem
          label={
            installingVersion
              ? t().detail.installing(installingVersion)
              : (t().detail.toolVersion ?? t().detail.protonVersion)
          }
          rgOptions={versionDropdownOptions}
          selectedOption={value || ''}
          onChange={(opt) => {
            const selected = withCurrent.find((o) => o.value === opt.data);
            onChange(opt.data, selected);
          }}
          disabled={!!installingVersion}
        />
      )}
    </>
  );
}
