// src/components/ConfigEditorModal.tsx
import { useState, useMemo } from 'react';
import {
  ModalRoot,
  Focusable,
  DialogButton,
  ToggleField,
  DropdownItem,
  TextField,
} from '@decky/ui';
import { toaster } from '@decky/api';
import { LAUNCH_VAR_CATALOG, buildLaunchOptions, parseLaunchOptions, type LaunchVarDef } from '../lib/launchVars';
import { addTrackedConfig, type TrackedConfig } from '../lib/trackedConfigs';
import { logFrontendEvent } from '../lib/logger';
import { t } from '../lib/i18n';
import type { GpuVendor } from '../types';

interface Props {
  appId: number | null;
  appName: string;
  existingConfig: TrackedConfig | null;
  gpuVendor: GpuVendor | null;
  onSave: () => void;
  closeModal?: () => void;
}

const STEAM_HEADER_URL = (id: number) =>
  `https://cdn.akamai.steamstatic.com/steam/apps/${id}/header.jpg`;

type Category = LaunchVarDef['category'];
const CATEGORY_ORDER: Category[] = ['nvidia', 'amd', 'intel', 'wrappers', 'performance', 'compatibility', 'debug'];
const VENDOR_CATEGORIES: Category[] = ['nvidia', 'amd', 'intel'];

function categoryLabel(cat: Category): string {
  return t().configManager.toggleCategories[cat];
}

/** Categories that don't match the detected GPU vendor start collapsed */
function initialCollapsed(gpuVendor: GpuVendor | null): Set<Category> {
  if (!gpuVendor || gpuVendor === 'other') return new Set<Category>();
  return new Set(
    VENDOR_CATEGORIES.filter((c) => c !== gpuVendor),
  );
}

export function ConfigEditorModal({ appId, appName, existingConfig, gpuVendor, onSave, closeModal }: Props) {
  const parsed = existingConfig
    ? parseLaunchOptions(existingConfig.launchOptions)
    : { protonVersion: null, vars: {} as Record<string, string> };

  const [protonVersion, setProtonVersion] = useState(parsed.protonVersion ?? '');
  const [enabledVars, setEnabledVars] = useState<Record<string, string>>(parsed.vars);
  const [customVars, setCustomVars] = useState<Array<{ key: string; value: string }>>(() => {
    const catalogKeys = new Set(LAUNCH_VAR_CATALOG.map((d) => d.key));
    return Object.entries(parsed.vars)
      .filter(([k]) => !catalogKeys.has(k))
      .map(([key, value]) => ({ key, value }));
  });
  const [collapsedCategories, setCollapsedCategories] = useState<Set<Category>>(
    () => initialCollapsed(gpuVendor),
  );

  const allVars = useMemo(() => {
    const merged = { ...enabledVars };
    for (const cv of customVars) {
      if (cv.key.trim()) merged[cv.key.trim()] = cv.value;
    }
    return merged;
  }, [enabledVars, customVars]);

  const preview = useMemo(
    () => buildLaunchOptions(protonVersion || null, allVars),
    [protonVersion, allVars],
  );

  const toggleVar = (key: string, def: LaunchVarDef) => {
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

  const addCustomVariable = () => {
    setCustomVars((prev) => [...prev, { key: '', value: '1' }]);
  };

  const updateCustomVar = (index: number, field: 'key' | 'value', val: string) => {
    setCustomVars((prev) => prev.map((cv, i) => (i === index ? { ...cv, [field]: val } : cv)));
  };

  const removeCustomVar = (index: number) => {
    setCustomVars((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleCategory = (cat: Category) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const handleApply = async () => {
    if (!appId) return;
    const finalLaunchOptions = preview;
    try {
      await SteamClient.Apps.SetAppLaunchOptions(appId, finalLaunchOptions);
      addTrackedConfig({
        appId,
        appName,
        protonVersion: protonVersion || '',
        launchOptions: finalLaunchOptions,
        enabledVars: allVars,
        appliedAt: Date.now(),
        isEdited: !!existingConfig,
      });
      void logFrontendEvent('INFO', 'Config editor applied', { appId, appName, launchOptions: finalLaunchOptions });
      toaster.toast({ title: 'Proton Pulse', body: finalLaunchOptions });
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

        {/* ── Fixed header: game info + actions ── */}
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
              <img
                src={STEAM_HEADER_URL(appId)}
                style={{ height: 32, borderRadius: 3, objectFit: 'cover' }}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f4ff' }}>
                {appName || (appId ? `App ${appId}` : t().configManager.createConfig)}
              </div>
              {appId && <div style={{ fontSize: 9, color: '#7a9bb5' }}>AppID {appId}</div>}
            </div>
          </div>
          <Focusable style={{ display: 'flex', gap: 8 }}>
            <DialogButton
              onClick={handleApply}
              disabled={!appId}
              style={{ minWidth: 80, padding: '6px 16px', fontSize: 12 }}
            >
              {t().common.apply}
            </DialogButton>
            <DialogButton
              onClick={() => closeModal?.()}
              style={{ minWidth: 80, padding: '6px 16px', fontSize: 12, background: '#555' }}
            >
              {t().common.cancel}
            </DialogButton>
          </Focusable>
        </div>

        {/* ── Live preview bar ── */}
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
            borderBottom: '1px solid #1a2430',
          }}
        >
          <span style={{ fontSize: 9, color: '#7a9bb5', marginRight: 8 }}>{t().configManager.livePreview}</span>
          {preview}
        </div>

        {/* ── Scrollable content ── */}
        <Focusable style={{ flex: 1, overflowY: 'auto', padding: '8px 16px' }}>
          {/* Proton Version */}
          <div style={{ marginBottom: 10 }}>
            <TextField
              label={t().detail.protonVersion}
              value={protonVersion}
              onChange={(e) => setProtonVersion(e.target.value)}
            />
          </div>

          {/* Toggle sections by category */}
          {CATEGORY_ORDER.map((cat) => {
            const defs = grouped.get(cat)!;
            if (defs.length === 0) return null;
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
                    ({defs.filter((d) => d.key in enabledVars).length}/{defs.length})
                  </span>
                </Focusable>
                {!collapsed && defs.map((def) => (
                  <div key={def.key} style={{ marginBottom: 2 }}>
                    {def.type === 'bool' ? (
                      <ToggleField
                        label={def.key}
                        description={def.description}
                        checked={def.key in enabledVars}
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

          {/* Custom Variables */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#cfe2f4', marginBottom: 6, borderBottom: '1px solid #2a3a4a', paddingBottom: 4 }}>
              {t().configManager.customVariables}
            </div>
            {customVars.map((cv, i) => (
              <Focusable key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center' }}>
                <TextField
                  label="KEY"
                  value={cv.key}
                  onChange={(e) => updateCustomVar(i, 'key', e.target.value)}
                />
                <span style={{ color: '#7a9bb5' }}>=</span>
                <TextField
                  label="VALUE"
                  value={cv.value}
                  onChange={(e) => updateCustomVar(i, 'value', e.target.value)}
                />
                <DialogButton
                  onClick={() => removeCustomVar(i)}
                  style={{ minWidth: 30, padding: '4px 8px', fontSize: 11, background: '#555' }}
                >
                  ✕
                </DialogButton>
              </Focusable>
            ))}
            <DialogButton onClick={addCustomVariable} style={{ fontSize: 11 }}>
              + {t().configManager.addCustomVar}
            </DialogButton>
          </div>
        </Focusable>
      </div>
    </ModalRoot>
  );
}
