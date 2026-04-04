// src/components/tabs/GeneralSettingsTab.tsx
import { DropdownItem, Focusable, GamepadButton, ToggleField } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { callable } from '@decky/api';
import { useEffect, useState } from 'react';
import { getSetting, setSetting } from '../../lib/settings';
import { logFrontendEvent } from '../../lib/logger';
import { t, setLanguage, useLanguage, LANGUAGES, LANGUAGE_NAMES, detectLanguage, type Language } from '../../lib/i18n';

const setLogLevel = callable<[level: string], boolean>('set_log_level');

function sectionStyle(): React.CSSProperties {
  return {
    margin: '0',
    padding: '16px 0 18px',
    borderRadius: 0,
    background: 'transparent',
    border: 0,
    borderTop: '1px solid rgba(255,255,255,0.07)',
    boxShadow: 'none',
    overflow: 'hidden',
  };
}

function focusClipRowStyle(): React.CSSProperties {
  return {
    borderRadius: 10,
    overflow: 'hidden',
    margin: '0 8px',
  };
}

export function GeneralSettingsTab() {
  const [debugEnabled, setDebugEnabled] = useState(() => getSetting('debugEnabled', false));
  const [ghToken, setGhToken] = useState(() => getSetting<string>('gh-votes-token', ''));

  useEffect(() => {
    void setLogLevel(debugEnabled ? 'DEBUG' : 'INFO').catch((error) => {
      console.error('Proton Pulse: failed to sync debug setting from Settings tab', error);
    });
  }, [debugEnabled]);

  const handleDebugToggle = async (enabled: boolean) => {
    void logFrontendEvent('INFO', 'Debug logging toggle changed', {
      previousValue: debugEnabled,
      nextValue: enabled,
    });
    setDebugEnabled(enabled);
    setSetting('debugEnabled', enabled);
  };

  const handleTokenChange = (value: string) => {
    void logFrontendEvent('DEBUG', 'GitHub token field updated', {
      hasToken: value.trim().length > 0,
      length: value.length,
    });
    setGhToken(value);
    setSetting('gh-votes-token', value);
  };

  const lang = useLanguage(); // subscribes to re-render on language change
  const currentPref = getSetting<Language | 'auto'>('language', 'auto');
  const detectedName = LANGUAGE_NAMES[detectLanguage()];
  const langOptions = [
    { data: 'auto' as const, label: t().settings.autoDetected(detectedName) },
    ...LANGUAGES.map((code) => ({ data: code, label: LANGUAGE_NAMES[code] })),
  ];

  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      evt.preventDefault();
    }
  };

  return (
    <Focusable onGamepadDirection={handleRootDirection}>
      <div style={sectionStyle()}>
        <div style={{ fontSize: 15, fontWeight: 700, color: '#eef7ff', marginBottom: 8 }}>
          {t().settings.general}
        </div>
        <div style={focusClipRowStyle()}>
          <DropdownItem
            label={t().settings.language}
            rgOptions={langOptions}
            selectedOption={currentPref}
            onChange={(opt) => setLanguage(opt.data)}
          />
        </div>
        <div style={focusClipRowStyle()}>
          <ToggleField
            label={t().settings.debugLogs}
            description={t().settings.debugLogsDescription}
            checked={debugEnabled}
            onChange={handleDebugToggle}
          />
        </div>
        <div style={focusClipRowStyle()}>
          <div style={{ padding: '8px 16px' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#e8f4ff', marginBottom: 2 }}>
              {t().settings.ghToken}
            </div>
            <div style={{ fontSize: 11, color: '#7a9bb5', marginBottom: 6 }}>
              {t().settings.ghTokenDescription}
            </div>
            <input
              type="password"
              value={ghToken}
              onChange={(e) => handleTokenChange(e.target.value)}
              placeholder="ghp_…"
              style={{
                width: '100%',
                boxSizing: 'border-box',
                background: '#1a2a3a',
                border: '1px solid #2a3a4a',
                borderRadius: 6,
                color: '#e8f4ff',
                fontSize: 12,
                padding: '6px 10px',
              }}
            />
          </div>
        </div>
      </div>
    </Focusable>
  );
}
