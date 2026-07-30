// src/components/ConfigEditorModal.tsx
import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  ModalRoot,
  Focusable,
  DialogButton,
  GamepadButton,
  ToggleField,
  DropdownItem,
  TextField,
  Field,
  SteamSpinner,
  showModal,
} from '@decky/ui';
import { toaster } from '../lib/notify';
import { LAUNCH_VAR_CATALOG, buildLaunchOptions, parseLaunchOptions, type LaunchVarDef } from '../lib/launchVars';
import { addTrackedConfig, type TrackedConfig } from '../lib/trackedConfigs';
import { pushConfig } from '../lib/cloudSync';
import { getProtonGeManagerState, installProtonGe } from '../lib/compatTools';
import { maybeToastRollingSlotChange } from '../lib/rollingSlotToast';
import {
  getScopedCustomToggles,
  inferCustomToggleValueType,
  normalizeCustomToggleValue,
  syncScopedCustomToggles,
  type CustomToggleScope,
  type CustomToggleValueType,
  type StoredCustomToggle,
} from '../lib/customToggles';
import { logFrontendEvent, callWithTimeout } from '../lib/logger';
import { t } from '../lib/i18n';
import { bucketPlaytimeMinutes, buildConfigKey, getEffectivePlaytimeMinutes } from '../lib/playtime';
import { NativePulseReportModal } from './NativePulseReportModal';
import { getLaunchOptionsFromDetails, getSteamAppDetails, isSteamShortcutApp } from '../lib/steamApps';
import { getGameSource, sourceStoreLabel, type GameSourceInfo } from '../lib/gameSource';
import { GameBanner } from './GameBanner';
import type { GpuVendor, ProtonGeManagerState, SystemInfo } from '../types';
import type { VersionOption } from '../lib/compatToolVersions';
import { CompatToolVersionPicker } from './CompatToolVersionPicker';
import { callable } from '@decky/api';

const getSystemInfo = callable<[], SystemInfo>('get_system_info');
const getSystemInfoSafe = () => callWithTimeout(() => getSystemInfo(), 'get_system_info');

interface Props {
  appId: number | null;
  appName: string;
  existingConfig: TrackedConfig | null;
  gpuVendor: GpuVendor | null;
  onSave: () => void;
  screenshotMode?: 'custom-toggle-manager' | 'upload-preview' | 'native-pulse-report';
  closeModal?: () => void;
}

type Category = LaunchVarDef['category'];
type SectionKey = Category | 'custom';
const CATEGORY_ORDER: Category[] = ['nvidia', 'amd', 'intel', 'wrappers', 'performance', 'compatibility', 'debug'];
const VENDOR_CATEGORIES: Category[] = ['nvidia', 'amd', 'intel'];

type GpuFilter = GpuVendor | 'all';
const GPU_FILTER_ORDER: GpuFilter[] = ['all', 'nvidia', 'amd', 'intel'];
function gpuFilterLabel(filter: GpuFilter): string {
  const extras = t().extras!;
  if (filter === 'all') return extras.all();
  if (filter === 'other') return extras.other();
  return filter.toUpperCase() === 'AMD' ? 'AMD' : filter === 'nvidia' ? 'NVIDIA' : 'Intel';
}

function categoryLabel(cat: Category): string {
  return t().configManager.toggleCategories[cat];
}

/** All categories start collapsed by default for a cleaner first pass. */
function initialCollapsed(_gpuVendor: GpuVendor | null): Set<SectionKey> {
  return new Set<SectionKey>(['custom', ...CATEGORY_ORDER]);
}

/** Should this category be hidden by the GPU filter? */
function isCategoryHidden(cat: Category, gpuFilter: GpuFilter): boolean {
  if (gpuFilter === 'all') return false;
  if (!VENDOR_CATEGORIES.includes(cat)) return false; // non-vendor categories always shown
  return cat !== gpuFilter;
}

function customToggleStorageTypeLabel(scope: CustomToggleScope): string {
  return scope === 'global'
    ? t().configManager.customToggleScopeGlobalShort
    : t().configManager.customToggleScopeLocalShort;
}

function customToggleValueTypeLabel(valueType: CustomToggleValueType): string {
  if (valueType === 'bool') return t().configManager.customToggleTypeBool;
  if (valueType === 'int') return t().configManager.customToggleTypeInt;
  if (valueType === 'float') return t().configManager.customToggleTypeFloat;
  if (valueType === 'toggle') return t().configManager.customToggleTypeToggle;
  return t().configManager.customToggleTypeString;
}

function buildCustomToggleId(item: Pick<StoredCustomToggle, 'scope' | 'appId' | 'key' | 'value' | 'valueType'>): string {
  const payload = item.key.trim() || item.value.trim();
  return `${item.scope}:${item.appId ?? 'global'}:${item.valueType}:${payload}`;
}

function buildToggleStateFromParsedLaunchOptions(
  parsed: ReturnType<typeof parseLaunchOptions>,
  appId: number | null,
  catalogKeys: Set<string>,
  catalogRawKeys?: Set<string>,
) {
  const stored = getScopedCustomToggles(appId);
  const storedKeys = new Set(stored.map((toggle) => `${toggle.scope}:${toggle.appId ?? 'global'}:${toggle.key}:${toggle.value}`));
  const inferredScope: CustomToggleScope = appId !== null ? 'game' : 'global';

  const parsedCustoms = Object.entries(parsed.vars)
    .filter(([key]) => !catalogKeys.has(key))
    .map(([key, value]) => ({
      id: buildCustomToggleId({
        scope: inferredScope,
        appId: inferredScope === 'game' ? appId ?? undefined : undefined,
        key,
        value,
        valueType: inferCustomToggleValueType(value),
      }),
      title: key,
      key,
      scope: inferredScope,
      appId: inferredScope === 'game' ? appId ?? undefined : undefined,
      valueType: inferCustomToggleValueType(value),
      value,
    } satisfies StoredCustomToggle))
    .filter((toggle) => !storedKeys.has(`${toggle.scope}:${toggle.appId ?? 'global'}:${toggle.key}:${toggle.value}`));

  const parsedArgs = [...parsed.rawArgs.filter((a) => !catalogRawKeys?.has(a)), ...parsed.postCommandArgs]
    .map((value) => {
      const valueType = parsed.postCommandArgs.includes(value) ? 'toggle' : inferCustomToggleValueType(value);
      return {
        id: buildCustomToggleId({
          scope: inferredScope,
          appId: inferredScope === 'game' ? appId ?? undefined : undefined,
          key: '',
          value,
          valueType,
        }),
        title: value,
        key: '',
        scope: inferredScope,
        appId: inferredScope === 'game' ? appId ?? undefined : undefined,
        valueType,
        value,
      } satisfies StoredCustomToggle;
    })
    .filter((toggle) => !storedKeys.has(`${toggle.scope}:${toggle.appId ?? 'global'}:${toggle.key}:${toggle.value}`));

  const customToggles = [...stored, ...parsedCustoms, ...parsedArgs];
  const enabledCustomToggleIds = new Set(
    customToggles
      .filter((toggle) => {
        if (toggle.key.trim()) return Object.prototype.hasOwnProperty.call(parsed.vars, toggle.key);
        return parsed.rawArgs.includes(toggle.value) || parsed.postCommandArgs.includes(toggle.value);
      })
      .map((toggle) => toggle.id),
  );

  return {
    protonVersion: parsed.protonVersion ?? '',
    enabledVars: Object.fromEntries(
      Object.entries(parsed.vars).filter(([key]) => catalogKeys.has(key)),
    ),
    customToggles,
    enabledCustomToggleIds,
  };
}

interface CustomToggleManagerModalProps {
  appId: number | null;
  toggles: StoredCustomToggle[];
  onSave: (toggles: StoredCustomToggle[], newlyAddedIds: string[]) => void;
  closeModal?: () => void;
}

function CustomToggleManagerModal({ appId, toggles, onSave, closeModal }: CustomToggleManagerModalProps) {
  const supportsGameScope = appId !== null;
  const defaultScope: CustomToggleScope = supportsGameScope ? 'game' : 'global';
  const editButtonRefs = useRef<Record<string, HTMLElement | null>>({});
  const removeButtonRefs = useRef<Record<string, HTMLElement | null>>({});
  const footerCancelRef = useRef<HTMLElement | null>(null);
  const footerSaveRef = useRef<HTMLElement | null>(null);
  const draftSaveRef = useRef<HTMLElement | null>(null);
  const [items, setItems] = useState(toggles);
  const [newlyAddedIds, setNewlyAddedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [key, setKey] = useState('');
  const [scope, setScope] = useState<CustomToggleScope>(defaultScope);
  const [valueType, setValueType] = useState<CustomToggleValueType>('string');
  const [value, setValue] = useState('');

  const resetDraft = () => {
    setTitle('');
    setKey('');
    setScope(defaultScope);
    setValueType('string');
    setValue('');
    setEditingId(null);
  };

  const saveToggleDraft = () => {
    const trimmedTitle = title.trim();
    const trimmedKey = key.trim();
    const normalizedValue = normalizeCustomToggleValue(valueType, value);
    // key is optional for value-only toggles (raw args like gamemoderun)
    if (!trimmedTitle || (!trimmedKey && !normalizedValue)) {
      toaster.toast({
        title: 'Proton Pulse',
        body: t().configManager.customToggleValidation,
      });
      return;
    }
    const nextItem: StoredCustomToggle = {
      id: editingId ?? buildCustomToggleId({
        scope,
        appId: scope === 'game' ? appId ?? undefined : undefined,
        key: trimmedKey,
        value: normalizedValue,
        valueType,
      }),
      title: trimmedTitle,
      key: trimmedKey,
      scope,
      appId: scope === 'game' ? appId ?? undefined : undefined,
      valueType,
      value: normalizedValue,
    };
    const duplicateItem = items.find((item) =>
      item.id !== editingId
      && item.key === trimmedKey
      && item.scope === scope
      && item.appId === nextItem.appId,
    );
    setItems((prev) => [
      ...prev.filter((item) =>
        item.id !== editingId
        && !(item.key === trimmedKey && item.scope === scope && item.appId === nextItem.appId),
      ),
      nextItem,
    ]);
    if (!editingId && !duplicateItem) {
      setNewlyAddedIds((prev) => new Set([...prev, nextItem.id]));
    }
    resetDraft();
  };

  const removeToggle = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setNewlyAddedIds((prev) => new Set([...prev].filter((itemId) => itemId !== id)));
    if (editingId === id) resetDraft();
  };

  const editToggle = (item: StoredCustomToggle) => {
    setEditingId(item.id);
    setTitle(item.title);
    setKey(item.key);
    setScope(item.scope);
    setValueType(item.valueType);
    setValue(item.value);
  };

  const handleSave = () => {
    onSave(items, [...newlyAddedIds]);
    toaster.toast({
      title: 'Proton Pulse',
      body: t().configManager.customToggleSaved,
    });
    closeModal?.();
  };

  return (
    <ModalRoot onCancel={closeModal}>
      <div
        style={{
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          width: 'min(620px, calc(100vw - 72px))',
          maxWidth: 'calc(100vw - 72px)',
          maxHeight: 'calc(100vh - 96px)',
          overflowY: 'auto',
          boxSizing: 'border-box',
          scrollPaddingBottom: 24,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700 }}>{t().configManager.customToggleManager}</div>
        <div style={{ fontSize: 12, color: '#7a9bb5' }}>{t().configManager.customToggleHint}</div>
        <div style={{ fontSize: 11, color: '#6a8ba5' }}>{t().configManager.customToggleDisabledHint}</div>
        {editingId && (
          <div style={{ fontSize: 12, color: '#9dc4e8', fontWeight: 700 }}>
            {t().configManager.customToggleEditing}
          </div>
        )}

        <div style={{ display: 'grid', gap: 10, width: '100%', minWidth: 0 }}>
          <div style={{ width: '100%', minWidth: 0, overflow: 'hidden' }}>
            <TextField
              label={t().configManager.customToggleTitle}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div style={{ width: '100%', minWidth: 0, overflow: 'hidden' }}>
            <TextField
              label={t().configManager.customToggleKey}
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_'))}
            />
          </div>
          <DropdownItem
            label={t().configManager.customToggleScope}
            rgOptions={[
              ...(supportsGameScope ? [{ data: 'game', label: t().configManager.customToggleScopeGame }] : []),
              { data: 'global', label: t().configManager.customToggleScopeGlobal },
            ]}
            selectedOption={scope}
            onChange={(opt) => setScope(opt.data as CustomToggleScope)}
          />
          <DropdownItem
            label={t().configManager.customToggleType}
            rgOptions={[
              { data: 'string', label: t().configManager.customToggleTypeString },
              { data: 'bool', label: t().configManager.customToggleTypeBool },
              { data: 'int', label: t().configManager.customToggleTypeInt },
              { data: 'float', label: t().configManager.customToggleTypeFloat },
              { data: 'toggle', label: t().configManager.customToggleTypeToggle },
            ]}
            selectedOption={valueType}
            onChange={(opt) => setValueType(opt.data as CustomToggleValueType)}
          />
          <div style={{ width: '100%', minWidth: 0, overflow: 'hidden' }}>
            <TextField
              label={t().configManager.customToggleValue}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            {editingId ? (
              <DialogButton onClick={resetDraft} style={{ minWidth: 120, background: '#555' }}>
                {t().common.cancel}
              </DialogButton>
            ) : <div />}
            <DialogButton
              ref={(node) => {
                draftSaveRef.current = node;
              }}
              onClick={saveToggleDraft}
              onGamepadDirection={(evt) => {
                if (evt.detail.button === GamepadButton.DIR_DOWN) {
                  evt.preventDefault();
                  if (items.length > 0) {
                    editButtonRefs.current[items[0].id]?.focus();
                  } else {
                    footerCancelRef.current?.focus();
                  }
                }
              }}
              style={{ minWidth: 180 }}
            >
              {editingId ? t().configManager.customToggleSaveButton : t().configManager.customToggleAdd}
            </DialogButton>
          </div>
        </div>

        <div style={{ fontSize: 14, fontWeight: 700, marginTop: 4 }}>
          {t().configManager.customToggleSavedSection}
        </div>
        {items.length === 0 ? (
          <div style={{ fontSize: 12, color: '#7a9bb5' }}>{t().configManager.customToggleEmpty}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map((item, index) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'rgba(255,255,255,0.03)',
                }}
              >
                <div style={{ display: 'grid', gap: 2, minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#e8f4ff' }}>{item.title}</div>
                  <div style={{ fontSize: 11, color: '#9dc4e8', overflowWrap: 'anywhere' }}>
                    {item.key ? `${item.key} = ${item.value}` : item.value}
                  </div>
                  <div style={{ fontSize: 10, color: '#7a9bb5' }}>
                    {t().configManager.customToggleType}: {customToggleStorageTypeLabel(item.scope)} . {customToggleValueTypeLabel(item.valueType)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
                  <DialogButton
                    ref={(node) => {
                      editButtonRefs.current[item.id] = node;
                    }}
                    onClick={() => editToggle(item)}
                    onGamepadDirection={(evt) => {
                      if (evt.detail.button === GamepadButton.DIR_RIGHT) {
                        evt.preventDefault();
                        removeButtonRefs.current[item.id]?.focus();
                        return;
                      }
                      if (evt.detail.button === GamepadButton.DIR_DOWN) {
                        evt.preventDefault();
                        const nextItem = items[index + 1];
                        if (nextItem) editButtonRefs.current[nextItem.id]?.focus();
                        else footerCancelRef.current?.focus();
                        return;
                      }
                      if (evt.detail.button === GamepadButton.DIR_UP) {
                        evt.preventDefault();
                        const prevItem = items[index - 1];
                        if (prevItem) editButtonRefs.current[prevItem.id]?.focus();
                        else draftSaveRef.current?.focus();
                      }
                    }}
                    style={{
                      minWidth: 68,
                      padding: '6px 10px',
                      fontSize: 12,
                    }}
                  >
                    {t().common.edit}
                  </DialogButton>
                  <DialogButton
                    ref={(node) => {
                      removeButtonRefs.current[item.id] = node;
                    }}
                    onClick={() => removeToggle(item.id)}
                    onGamepadDirection={(evt) => {
                      if (evt.detail.button === GamepadButton.DIR_LEFT) {
                        evt.preventDefault();
                        editButtonRefs.current[item.id]?.focus();
                        return;
                      }
                      if (evt.detail.button === GamepadButton.DIR_DOWN) {
                        evt.preventDefault();
                        const nextItem = items[index + 1];
                        if (nextItem) removeButtonRefs.current[nextItem.id]?.focus();
                        else footerSaveRef.current?.focus();
                        return;
                      }
                      if (evt.detail.button === GamepadButton.DIR_UP) {
                        evt.preventDefault();
                        const prevItem = items[index - 1];
                        if (prevItem) removeButtonRefs.current[prevItem.id]?.focus();
                        else draftSaveRef.current?.focus();
                      }
                    }}
                    style={{
                      minWidth: 44,
                      padding: '6px 8px',
                      fontSize: 12,
                      background: '#8d2f3a',
                      color: '#fff',
                    }}
                  >
                    x
                  </DialogButton>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8, paddingBottom: 8 }}>
          <DialogButton
            ref={(node) => {
              footerCancelRef.current = node;
            }}
            onClick={() => closeModal?.()}
            onGamepadDirection={(evt) => {
              if (evt.detail.button === GamepadButton.DIR_RIGHT) {
                evt.preventDefault();
                footerSaveRef.current?.focus();
                return;
              }
              if (evt.detail.button === GamepadButton.DIR_UP) {
                evt.preventDefault();
                const lastItem = items[items.length - 1];
                if (lastItem) editButtonRefs.current[lastItem.id]?.focus();
                else draftSaveRef.current?.focus();
              }
            }}
            style={{ background: '#555' }}
          >
            {t().common.cancel}
          </DialogButton>
          <DialogButton
            ref={(node) => {
              footerSaveRef.current = node;
            }}
            onClick={handleSave}
            onGamepadDirection={(evt) => {
              if (evt.detail.button === GamepadButton.DIR_LEFT) {
                evt.preventDefault();
                footerCancelRef.current?.focus();
                return;
              }
              if (evt.detail.button === GamepadButton.DIR_UP) {
                evt.preventDefault();
                const lastItem = items[items.length - 1];
                if (lastItem) removeButtonRefs.current[lastItem.id]?.focus();
                else draftSaveRef.current?.focus();
              }
            }}
          >
            {t().common.save}
          </DialogButton>
        </div>
      </div>
    </ModalRoot>
  );
}

// --- Upload Preview Modal ---

interface UploadPreviewProps {
  appName: string;
  profileName: string;
  protonVersion: string;
  launchOptions: string;
  enabledVars: Record<string, string>;
  systemInfo: SystemInfo | null;
  loadingSystemInfo: boolean;
  onApply: () => void;
  onUpload?: () => void;
  closeModal?: () => void;
}

function UploadPreviewModal({
  appName, profileName, protonVersion, launchOptions, enabledVars, systemInfo, loadingSystemInfo, onApply, onUpload, closeModal,
}: UploadPreviewProps) {
  const cancelRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    // Steam navmesh focuses buttons after mount - override scroll after that settles
    const id = window.setTimeout(() => scrollRef.current?.scrollTo({ top: 0 }), 80);
    return () => window.clearTimeout(id);
  }, []);
  const na = (v: string | number | null | undefined) =>
    v != null && v !== '' ? String(v) : 'Not available';

  const infoRows: [string, string][] = [
    ['Game', appName],
    ['Profile', profileName || '(unnamed)'],
    ['Proton', protonVersion || 'None'],
    ['Launch options', launchOptions || '(none)'],
    ...Object.entries(enabledVars).map(([k, v]) => [k, v] as [string, string]),
    ['GPU', na(systemInfo?.gpu)],
    ['GPU Driver', na(systemInfo?.driver_version)],
    ['CPU', na(systemInfo?.cpu)],
    ['RAM', systemInfo?.ram_gb != null ? `${systemInfo.ram_gb} GB` : 'Not available'],
    ['OS', na(systemInfo?.distro)],
    ['Kernel', na(systemInfo?.kernel)],
  ];

  return (
    <ModalRoot onCancel={closeModal}>
      <div
        style={{
          padding: 16,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          width: 'min(620px, calc(100vw - 72px))',
          maxWidth: 'calc(100vw - 72px)',
          height: 'calc(100vh - 96px)',
          maxHeight: 'calc(100vh - 96px)',
          boxSizing: 'border-box',
          overflow: 'hidden',
        }}
      >
        <div style={{ flexShrink: 0, fontSize: 16, fontWeight: 700, color: '#e8f4ff' }}>{t().configManager.uploadPreviewTitle}</div>
        <div style={{ flexShrink: 0, fontSize: 11, color: '#7a9bb5' }}>
          {t().configManager.uploadPreviewHint}
        </div>

        {/* scrollable rows - Focusable enables gamepad d-pad scroll */}
        <Focusable
          ref={(node: HTMLDivElement | null) => { scrollRef.current = node; }}
          style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}
          onGamepadDirection={(evt) => {
            const el = scrollRef.current;
            if (!el) return;
            if (evt.detail.button === GamepadButton.DIR_UP) {
              if (el.scrollTop > 0) { el.scrollBy({ top: -60, behavior: 'smooth' }); evt.preventDefault(); }
            }
            if (evt.detail.button === GamepadButton.DIR_DOWN) {
              const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 5;
              if (!atBottom) { el.scrollBy({ top: 60, behavior: 'smooth' }); evt.preventDefault(); }
              else { cancelRef.current?.focus(); evt.preventDefault(); }
            }
          }}
        >
          {loadingSystemInfo ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
              <SteamSpinner style={{ width: 16, height: 16 }} />
              <span style={{ fontSize: 11, color: '#7a9bb5' }}>{t().configManager.detectingHardware}</span>
            </div>
          ) : (
            infoRows.map(([label, value]) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '5px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <span style={{ fontSize: 11, color: '#7a9bb5', flexShrink: 0, minWidth: 110 }}>{label}</span>
                <span
                  style={{
                    fontSize: 11,
                    color: value === 'Not available' ? '#4a6a85' : '#cfe2f4',
                    textAlign: 'right',
                    wordBreak: 'break-all',
                    fontFamily: label === 'Launch options' || label.startsWith('PROTON') ? 'monospace' : 'inherit',
                  }}
                >
                  {value}
                </span>
              </div>
            ))
          )}
        </Focusable>

        <Focusable flow-children="horizontal" style={{ flexShrink: 0, display: 'flex', gap: 8, paddingTop: 4 }}>
          <DialogButton
            ref={(node) => { cancelRef.current = node; }}
            onClick={closeModal}
            style={{ background: '#555', flex: 1 }}
          >
            {t().common.cancel}
          </DialogButton>
          <DialogButton
            onClick={() => { onApply(); closeModal?.(); }}
            disabled={loadingSystemInfo}
            style={{ flex: 1 }}
          >
            {loadingSystemInfo ? t().common.loading : t().common.apply}
          </DialogButton>
          {onUpload && (
            <DialogButton
              onClick={() => { onUpload(); closeModal?.(); }}
              disabled={loadingSystemInfo}
              style={{ flex: 1 }}
            >
              {loadingSystemInfo ? t().common.loading : t().configManager.uploadToCloud}
            </DialogButton>
          )}
        </Focusable>
      </div>
    </ModalRoot>
  );
}

export function ConfigEditorModal({ appId, appName, existingConfig, gpuVendor, onSave, screenshotMode, closeModal }: Props) {
  const extras = t().extras!;
  const isShortcut = appId ? isSteamShortcutApp(appId) : false;
  const catalogKeys = new Set(LAUNCH_VAR_CATALOG.map((d) => d.key));
  const catalogRawKeys = new Set(LAUNCH_VAR_CATALOG.filter((d) => d.type === 'raw').map((d) => d.key));
  const parsed = existingConfig
    ? parseLaunchOptions(existingConfig.launchOptions)
    : { protonVersion: null, vars: {} as Record<string, string>, rawArgs: [] as string[], postCommandArgs: [] as string[] };
  const initialParsedState = buildToggleStateFromParsedLaunchOptions(parsed, appId, catalogKeys, catalogRawKeys);

  const [profileName, setProfileName] = useState(existingConfig?.profileName ?? '');
  const [profileNameTouched, setProfileNameTouched] = useState(false);
  const [protonVersion, setProtonVersion] = useState(initialParsedState.protonVersion);
  const [enabledVars, setEnabledVars] = useState<Record<string, string>>(initialParsedState.enabledVars);
  const [enabledRawKeys, setEnabledRawKeys] = useState<Set<string>>(
    () => new Set(parsed.rawArgs.filter((arg) => catalogRawKeys.has(arg))),
  );
  const [customToggles, setCustomToggles] = useState<StoredCustomToggle[]>(initialParsedState.customToggles);
  const [enabledCustomToggleIds, setEnabledCustomToggleIds] = useState<Set<string>>(initialParsedState.enabledCustomToggleIds);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loadingSystemInfo, setLoadingSystemInfo] = useState(true);
  const [managerState, setManagerState] = useState<ProtonGeManagerState | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  // Non-Steam shortcuts carry a source (Heroic / GOG / Epic / ...). We fetch
  // it on mount so the header pill can show the actual launcher instead of
  // the generic "steam shortcut" text or a misleading "Custom" label.
  const [headerGameSource, setHeaderGameSource] = useState<GameSourceInfo | null>(null);
  useEffect(() => {
    if (!appId || !isShortcut) return;
    let alive = true;
    void getGameSource(appId, appName).then((info) => {
      if (!alive) return;
      setHeaderGameSource(info);
      void logFrontendEvent('DEBUG', 'ConfigEditor: header game source loaded', {
        appId,
        source: info?.source ?? null,
        is_steam: info?.is_steam ?? null,
      });
    });
    return () => { alive = false; };
  }, [appId, appName, isShortcut]);
  const screenshotModeOpenedRef = useRef(false);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<SectionKey>>(
    () => initialCollapsed(gpuVendor),
  );
  const [gpuFilter, setGpuFilter] = useState<GpuFilter>(
    gpuVendor && gpuVendor !== 'other' ? gpuVendor : 'all',
  );

  // load hardware info for hardware preview
  useEffect(() => {
    setLoadingSystemInfo(true);
    getSystemInfoSafe()
      .then((info) => { if (info) setSystemInfo(info); })
      .catch(() => { /* system info unavailable, leave null */ })
      .finally(() => setLoadingSystemInfo(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // New configs should start from the game's current Steam launch options
  // when available, so the editor reflects what the user is already running
  useEffect(() => {
    if (existingConfig || !appId) return;
    void getSteamAppDetails(appId)
      .then((result) => {
        const currentLaunchOptions = getLaunchOptionsFromDetails(result.details);
        if (!currentLaunchOptions.trim()) return;
        const currentParsed = parseLaunchOptions(currentLaunchOptions);
        const parsedState = buildToggleStateFromParsedLaunchOptions(currentParsed, appId, catalogKeys, catalogRawKeys);
        if (currentParsed.protonVersion) {
          setProtonVersion((prev) => prev || currentParsed.protonVersion || '');
        }
        setEnabledVars((prev) => (Object.keys(prev).length ? prev : parsedState.enabledVars));
        setCustomToggles((prev) => (prev.length ? prev : parsedState.customToggles));
        setEnabledCustomToggleIds((prev) => (prev.size ? prev : parsedState.enabledCustomToggleIds));
        setEnabledRawKeys((prev) => {
          if (prev.size) return prev;
          return new Set(currentParsed.rawArgs.filter((arg) => catalogRawKeys.has(arg)));
        });
        void logFrontendEvent('DEBUG', 'Config editor prefilled from current Steam launch options', {
          appId,
          hasProtonVersion: !!currentParsed.protonVersion,
          varCount: Object.keys(currentParsed.vars).length,
          rawArgCount: currentParsed.rawArgs.length,
          postArgCount: currentParsed.postCommandArgs.length,
        });
      })
      .catch((error) => {
        void logFrontendEvent('WARNING', 'Failed to prefill config editor from current Steam launch options', {
          appId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  }, [existingConfig, appId]); // eslint-disable-line react-hooks/exhaustive-deps

  // load available proton versions for the dropdown
  useEffect(() => {
    getProtonGeManagerState(false)
      .then((state) => {
        setManagerState(state);
        setLoadingVersions(false);
      })
      .catch((err) => {
        void logFrontendEvent('WARNING', 'Failed to load Proton versions for ConfigEditor', {
          error: err instanceof Error ? err.message : String(err),
        });
        setLoadingVersions(false);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleVersionChange = (nextVersion: string, option?: VersionOption) => {
    setProtonVersion(nextVersion);
    const needsInstall = !!option && option.managed && !option.installed;
    // installProtonGe only installs Proton-GE builds. For a not-installed
    // CachyOS selection we set the version and log; family-aware install is a
    // follow-up.
    const looksLikeGe = /ge-?proton|proton-ge/i.test(nextVersion);
    if (!needsInstall) return;
    if (!looksLikeGe) {
      void logFrontendEvent('INFO', 'Selected not-installed non-GE compat version; skipping auto-install', {
        version: nextVersion,
        source: 'ConfigEditorModal.handleVersionChange',
      });
      return;
    }
    setInstalling(nextVersion);
    void logFrontendEvent('INFO', 'Auto-installing Proton version from config editor', { version: nextVersion });
    installProtonGe(nextVersion)
      .then((result) => {
        if (result.success) {
          toaster.toast({
            title: 'Proton Pulse',
            body: result.already_installed
              ? t().toast.alreadyInstalled(nextVersion)
              : t().toast.installed(nextVersion),
          });
          // #116: separate toast if the rolling latest-slot symlink got
          // re-pointed.
          maybeToastRollingSlotChange(result);
          // refetch so the version list reflects the new install state
          return getProtonGeManagerState(true).then(setManagerState);
        }
        toaster.toast({ title: 'Proton Pulse', body: t().toast.installFailed(result.message) });
        return undefined;
      })
      .catch((err) => {
        toaster.toast({
          title: 'Proton Pulse',
          body: t().toast.installFailed(err instanceof Error ? err.message : String(err)),
        });
      })
      .finally(() => setInstalling(null));
  };


  const allVars = useMemo(() => {
    const merged = { ...enabledVars };
    for (const toggle of customToggles) {
      if (enabledCustomToggleIds.has(toggle.id) && toggle.key.trim()) {
        merged[toggle.key.trim()] = normalizeCustomToggleValue(toggle.valueType, toggle.value);
      }
    }
    return merged;
  }, [enabledVars, customToggles, enabledCustomToggleIds]);

  // raw args from key-less custom toggles (wrappers, flags, etc) plus catalog raw entries
  const rawArgs = useMemo(() => {
    const args: string[] = [...enabledRawKeys];
    for (const toggle of customToggles) {
      if (enabledCustomToggleIds.has(toggle.id) && !toggle.key.trim() && toggle.value.trim() && toggle.valueType !== 'toggle') {
        args.push(normalizeCustomToggleValue(toggle.valueType, toggle.value));
      }
    }
    return args;
  }, [enabledRawKeys, customToggles, enabledCustomToggleIds]);

  const postCommandArgs = useMemo(() => {
    const args: string[] = [];
    for (const toggle of customToggles) {
      if (enabledCustomToggleIds.has(toggle.id) && !toggle.key.trim() && toggle.value.trim() && toggle.valueType === 'toggle') {
        args.push(normalizeCustomToggleValue(toggle.valueType, toggle.value));
      }
    }
    return args;
  }, [customToggles, enabledCustomToggleIds]);

  const preview = useMemo(
    () => buildLaunchOptions(protonVersion || null, allVars, rawArgs, postCommandArgs),
    [protonVersion, allVars, rawArgs, postCommandArgs],
  );

  const toggleVar = (key: string, def: LaunchVarDef) => {
    if (def.type === 'raw') {
      setEnabledRawKeys((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });
      return;
    }
    setEnabledVars((prev) => {
      const next = { ...prev };
      if (key in next) {
        delete next[key];
      } else {
        next[key] = def.defaultValue ?? '1';
      }
      return next;
    });
  };

  const setEnumVar = (key: string, value: string) => {
    setEnabledVars((prev) => ({ ...prev, [key]: value }));
  };

  const removeEnumVar = (key: string) => {
    setEnabledVars((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const toggleCategory = (cat: SectionKey) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const toggleCustomToggle = (id: string) => {
    setEnabledCustomToggleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Apply launch options to Steam + persist. Two independent knobs:
  //   pushCloud     -- also upload the config to user_proton_configs.
  //   openReport    -- also open NativePulseReportModal for report submission.
  // Save uses { pushCloud: true, openReport: false } -- persist without
  // nagging for a report. Submit Report uses openReport separately via
  // handlePublish so the two intents stay independent.
  const doApply = async (
    resolvedLaunchOptions: string,
    opts: { pushCloud?: boolean; openReport?: boolean } = {},
  ) => {
    if (!appId) return;
    const { pushCloud = false, openReport = false } = opts;
    try {
      await SteamClient.Apps.SetAppLaunchOptions(appId, resolvedLaunchOptions);
      const config: TrackedConfig = {
        appId,
        appName,
        profileName: profileName.trim(),
        protonVersion: protonVersion || '',
        launchOptions: resolvedLaunchOptions,
        enabledVars: allVars,
        appliedAt: Date.now(),
        isEdited: !!existingConfig,
        source: existingConfig?.source,
        cpu: systemInfo?.cpu ?? null,
        gpu: systemInfo?.gpu ?? null,
        gpuVendor: systemInfo?.gpu_vendor ?? null,
        gpuDriver: systemInfo?.driver_version ?? null,
        ram: systemInfo?.ram_gb != null ? `${systemInfo.ram_gb} GB` : null,
        os: systemInfo?.distro ?? null,
        kernel: systemInfo?.kernel ?? null,
        isNonSteam: isSteamShortcutApp(appId),
      };
      addTrackedConfig(config);
      if (pushCloud) {
        void pushConfig(config);
      }
      if (openReport) {
        const { minutes } = await getEffectivePlaytimeMinutes(appId, existingConfig ? buildConfigKey(existingConfig) : undefined);
        const autoDuration = bucketPlaytimeMinutes(minutes);
        const gsInfo = isSteamShortcutApp(appId) ? await getGameSource(appId, appName) : null;
        showModal(
          <NativePulseReportModal
            appId={appId}
            appName={appName}
            sysInfo={systemInfo}
            protonVersion={protonVersion || ''}
            autoDuration={autoDuration}
            launchOptions={resolvedLaunchOptions}
            gameSource={gsInfo}
          />,
        );
      }
      void logFrontendEvent('INFO', 'Config editor applied', { appId, appName, launchOptions: resolvedLaunchOptions, pushCloud, openReport });
      toaster.toast({ title: 'Proton Pulse', body: t().toast.savedToProtonPulse });
      onSave();
      closeModal?.();
    } catch (e) {
      void logFrontendEvent('ERROR', 'Config editor apply failed', {
        appId,
        error: e instanceof Error ? e.message : String(e),
      });
      toaster.toast({ title: 'Proton Pulse', body: t().configure.applyFailed(e instanceof Error ? e.message : String(e)) });
    }
  };

  // Open the Native Pulse report modal with current editor state pre-filled.
  // Duration is pulled from the local playtime tracker so the user doesn't
  // have to pick a bucket manually - totally transparent
  const handlePublish = async () => {
    if (!appId) {
      toaster.toast({ title: 'Proton Pulse', body: 'No game selected. Open a game config first.' });
      return;
    }
    if (!protonVersion) {
      toaster.toast({ title: 'Proton Pulse', body: t().configure.applyFailed('Proton version is required. Select a Proton version above.') });
      return;
    }
    void logFrontendEvent('INFO', 'Publish to Pulse clicked', { appId, appName });

    let gameSource: GameSourceInfo | null = null;
    if (isSteamShortcutApp(appId)) {
      gameSource = await getGameSource(appId, appName);
      if (!gameSource?.gog_product_id && !gameSource?.epic_game_id) {
        toaster.toast({ title: 'Proton Pulse', body: extras.shortcutCannotSubmit() });
        return;
      }
    }

    const configKey = existingConfig ? buildConfigKey(existingConfig) : undefined;
    const { minutes, trackedMinutes, steamMinutes, configMinutes } = await getEffectivePlaytimeMinutes(appId, configKey);
    const autoDuration = bucketPlaytimeMinutes(minutes);
    void logFrontendEvent('DEBUG', 'Publish auto-duration resolved', {
      appId, minutes, trackedMinutes, steamMinutes, configMinutes, autoDuration,
    });
    showModal(
      <NativePulseReportModal
        appId={appId}
        appName={appName}
        sysInfo={systemInfo}
        protonVersion={protonVersion}
        autoDuration={autoDuration}
        autoDurationMinutes={minutes}
        launchOptions={preview}
        configKey={configKey}
        gameSource={gameSource}
      />,
    );
  };

  // Save: apply launch options + push to cloud, no report modal. Skips the
  // UploadPreviewModal middleman and the Append/Replace prompt (see
  // LaunchOptionConflictModal -- resolveLaunchOptionsWithPrompt now always
  // replaces). Report submission is a separate "Submit Report" action so
  // Save can be a quick "persist my config" action without nagging the user
  // to fill in playtime / hardware / notes.
  const handleSave = async () => {
    if (!appId) {
      toaster.toast({ title: 'Proton Pulse', body: 'No game selected. Open a game config first.' });
      return;
    }
    if (!profileName.trim()) {
      setProfileNameTouched(true);
      toaster.toast({ title: 'Proton Pulse', body: t().configManager.profileNameRequired });
      return;
    }
    try {
      syncScopedCustomToggles(appId, customToggles);
      await doApply(preview, { pushCloud: true, openReport: false });
    } catch (e) {
      void logFrontendEvent('ERROR', 'Config editor save failed', {
        appId,
        error: e instanceof Error ? e.message : String(e),
      });
      toaster.toast({ title: 'Proton Pulse', body: t().configure.applyFailed(e instanceof Error ? e.message : String(e)) });
    }
  };

  const openCustomToggleModal = () => {
    const modal = showModal(
      <CustomToggleManagerModal
        appId={appId}
        toggles={customToggles}
        onSave={(toggles, newlyAddedIds) => {
          setCustomToggles(toggles);
          setEnabledCustomToggleIds((prev) => new Set(
            [...prev].filter((id) =>
              toggles.some((toggle) => toggle.id === id) && !newlyAddedIds.includes(id),
            ),
          ));
          syncScopedCustomToggles(appId, toggles);
          modal?.Close();
        }}
      />,
    );
  };

  const openUploadPreviewForScreenshot = () => {
    showModal(
      <UploadPreviewModal
        appName={appName}
        profileName={profileName.trim() || 'Steam Deck Tweaks'}
        protonVersion={protonVersion || 'GE-Proton10-1'}
        launchOptions={preview}
        enabledVars={allVars}
        systemInfo={systemInfo}
        loadingSystemInfo={loadingSystemInfo}
        onApply={() => {}}
      />,
    );
  };

  useEffect(() => {
    if (!screenshotMode || screenshotModeOpenedRef.current) return;
    screenshotModeOpenedRef.current = true;
    const timer = window.setTimeout(() => {
      if (screenshotMode === 'custom-toggle-manager') {
        openCustomToggleModal();
      } else if (screenshotMode === 'upload-preview') {
        openUploadPreviewForScreenshot();
      } else if (screenshotMode === 'native-pulse-report' && appId) {
        showModal(
          <NativePulseReportModal
            appId={appId}
            appName={appName}
            sysInfo={systemInfo}
            protonVersion={protonVersion || 'GE-Proton10-1'}
            autoDuration="oneToFourHours"
            launchOptions={preview}
          />,
        );
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [screenshotMode, appId, appName, systemInfo, protonVersion, preview, loadingSystemInfo]);

  const grouped = useMemo(() => {
    const map = new Map<Category, LaunchVarDef[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const def of LAUNCH_VAR_CATALOG) {
      map.get(def.category)!.push(def);
    }
    return map;
  }, []);

  return (
    <ModalRoot
      onCancel={closeModal}
      bAllowFullSize
      className="proton-pulse-config-editor"
      modalClassName="proton-pulse-config-editor"
    >
      <style>{`
        .proton-pulse-config-editor,
        .proton-pulse-config-editor > div,
        .proton-pulse-config-editor .DialogContent_InnerWidth {
          padding: 0 !important;
          margin: 0 !important;
          max-width: 100vw !important;
          width: 100vw !important;
          max-height: 100vh !important;
        }
        .proton-pulse-config-editor .ModalPosition { inset: 0 !important; }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)' }}>

        {/* --- Fixed header: game info + actions --- */}
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 16px',
            borderBottom: '1px solid #2a3a4a',
            background: 'linear-gradient(180deg, rgba(26,36,49,0.98), rgba(13,19,28,0.98))',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {appId && (
              <GameBanner
                appId={appId}
                style={{ height: 32, borderRadius: 3, objectFit: 'cover' }}
              />
            )}
            <div>
              {/* Title only -- launcher + store are covered by the subtitle
                  right below. Pills used to also render here but that was
                  the same info twice and it crowded long titles. B on the
                  gamepad closes the modal, so no in-header Cancel either. */}
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f4ff' }}>
                {appName || (appId ? `App ${appId}` : t().configManager.createConfig)}
              </div>
              {appId && (
                <div style={{ fontSize: 9, color: '#7a9bb5' }}>
                  {isShortcut
                    ? [headerGameSource?.source, sourceStoreLabel(headerGameSource)]
                        .filter(Boolean)
                        .join(' . ') || extras.nonSteamShortcut()
                    : extras.appIdLabel(appId)}
                </div>
              )}
            </div>
          </div>
          <Focusable style={{ display: 'flex', gap: 8 }}>
            <DialogButton
              onClick={() => { void handleSave(); }}
              style={{ minWidth: 80, padding: '6px 16px', fontSize: 12 }}
            >
              {t().common.save}
            </DialogButton>
            <DialogButton
              onClick={() => { void handlePublish(); }}
              style={{ minWidth: 140, padding: '6px 16px', fontSize: 12 }}
            >
              {t().nativeReport.submit}
            </DialogButton>
            <DialogButton
              onClick={openCustomToggleModal}
              style={{ minWidth: 164, padding: '6px 18px', fontSize: 12 }}
            >
              {t().configManager.customToggleButton}
            </DialogButton>
          </Focusable>
        </div>

        {/* --- Live preview bar --- */}
        <div
          style={{
            flexShrink: 0,
            padding: '6px 16px',
            background: 'rgba(0,0,0,0.4)',
            fontFamily: 'monospace',
            fontSize: 10,
            color: '#9dc4e8',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          <span style={{ fontSize: 9, color: '#7a9bb5', marginRight: 8 }}>{t().configManager.livePreview}</span>
          {preview}
        </div>
        <div style={{ flexShrink: 0, padding: '4px 16px', fontSize: 10, color: '#6a8ba5', lineHeight: 1.4 }}>
          {t().configManager.previewHint}
        </div>

        {/* --- Scrollable content --- */}
        <Focusable style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
          {/* Profile Name + GPU filter + Rating + Proton Version - uniform compact rows */}
          <div style={{ marginBottom: 10, display: 'grid', gap: 0 }}>
            {/* Profile name - Field is not focusable so TextField owns the gamepad nav directly (single A press, native cursor) */}
            <div
              style={profileNameTouched && !profileName.trim() ? { outline: '1px solid #ef4444', borderRadius: 2 } : undefined}
            >
              <Field
                label={t().configManager.profileName}
                childrenContainerWidth="fixed"
              >
                <TextField
                  value={profileName}
                  onChange={(e) => {
                    setProfileName(e.target.value);
                    if (e.target.value.trim()) setProfileNameTouched(false);
                  }}
                />
              </Field>
            </div>
            <DropdownItem
              label={t().configManager.gpuFilter}
              rgOptions={GPU_FILTER_ORDER.map((f) => ({ data: f, label: gpuFilterLabel(f) }))}
              selectedOption={gpuFilter}
              onChange={(opt) => setGpuFilter(opt.data as GpuFilter)}
            />
            {loadingVersions || !managerState ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                <SteamSpinner style={{ width: 16, height: 16 }} />
                <span style={{ fontSize: 11, color: '#7a9bb5' }}>{t().common.loading}</span>
              </div>
            ) : (
              <CompatToolVersionPicker
                value={protonVersion || ''}
                onChange={handleVersionChange}
                managerState={managerState}
                installingVersion={installing}
              />
            )}
          </div>

          {customToggles.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <Focusable
                onClick={() => toggleCategory('custom')}
                onOKButton={() => toggleCategory('custom')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  padding: '6px 0',
                  borderBottom: '1px solid #2a3a4a',
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 10, color: '#7a9bb5' }}>{collapsedCategories.has('custom') ? '▸' : '▾'}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#cfe2f4' }}>
                  {t().configManager.customToggleButton}
                </span>
                <span style={{ fontSize: 10, color: '#7a9bb5' }}>
                  ({enabledCustomToggleIds.size}/{customToggles.length})
                </span>
              </Focusable>
              {!collapsedCategories.has('custom') && customToggles.map((toggle) => (
                <div key={toggle.id} style={{ marginBottom: 2 }}>
                  <ToggleField
                    label={toggle.title}
                    description={toggle.key ? `${toggle.key} = ${toggle.value}` : toggle.value}
                    checked={enabledCustomToggleIds.has(toggle.id)}
                    onChange={() => toggleCustomToggle(toggle.id)}
                  />
                </div>
              ))}
            </div>
          )}

          {/* Toggle sections by category */}
          {CATEGORY_ORDER.map((cat) => {
            const defs = grouped.get(cat)!;
            if (defs.length === 0) return null;
            if (isCategoryHidden(cat, gpuFilter)) return null;
            const collapsed = collapsedCategories.has(cat);
            return (
              <div key={cat} style={{ marginBottom: 6 }}>
                <Focusable
                  onClick={() => toggleCategory(cat)}
                  onOKButton={() => toggleCategory(cat)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    padding: '6px 0',
                    borderBottom: '1px solid #2a3a4a',
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 10, color: '#7a9bb5' }}>{collapsed ? '▸' : '▾'}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: '#cfe2f4' }}>
                    {categoryLabel(cat)}
                  </span>
                  <span style={{ fontSize: 10, color: '#7a9bb5' }}>
                    ({defs.filter((d) => d.type === 'raw' ? enabledRawKeys.has(d.key) : d.key in enabledVars).length}/{defs.length})
                  </span>
                </Focusable>
                {!collapsed && defs.map((def) => (
                  <div key={def.key} style={{ marginBottom: 2 }}>
                    {def.type === 'bool' || def.type === 'raw' ? (
                      <ToggleField
                        label={def.key}
                        description={def.hint ? `${def.description} - ${def.hint}` : def.description}
                        checked={def.type === 'raw' ? enabledRawKeys.has(def.key) : def.key in enabledVars}
                        onChange={() => toggleVar(def.key, def)}
                      />
                    ) : (
                      <div>
                        <ToggleField
                          label={def.key}
                          description={def.description}
                          checked={def.key in enabledVars}
                          onChange={() => {
                            if (def.key in enabledVars) removeEnumVar(def.key);
                            else setEnumVar(def.key, def.options![0]);
                          }}
                        />
                        {def.key in enabledVars && (
                          <DropdownItem
                            label={def.key}
                            rgOptions={def.options!.map((o) => ({ data: o, label: o }))}
                            selectedOption={enabledVars[def.key]}
                            onChange={(opt) => setEnumVar(def.key, opt.data)}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}

        </Focusable>
      </div>
    </ModalRoot>
  );
}
