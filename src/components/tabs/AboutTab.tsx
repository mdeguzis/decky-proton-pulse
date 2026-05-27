// src/components/tabs/AboutTab.tsx
import { useEffect, useRef, useState } from 'react';
import { callable } from '@decky/api';
import { Focusable, DialogButton, Dropdown, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { BrandLogo } from '../BrandLogo';
import { toaster } from '../../lib/notify';
import { t } from '../../lib/i18n';
import { openIssue, type IssueTemplate } from '../../lib/issueReport';
import { registerScreenshotAutomationHandler } from '../../lib/screenshotAutomation';
import { callWithTimeout } from '../../lib/logger';

const getPluginVersion = callable<[], string>('get_plugin_version');
const getPluginVersionSafe = () =>
  callWithTimeout(() => getPluginVersion(), 'get_plugin_version', 5000);

const ISSUE_TEMPLATES: { data: IssueTemplate; labelKey: keyof ReturnType<typeof t>['about'] }[] = [
  { data: 'game_report', labelKey: 'issueTemplateGameReport' },
  { data: 'missing_reports', labelKey: 'issueTemplateMissingReports' },
  { data: 'plugin_issue', labelKey: 'issueTemplatePluginIssue' },
  { data: 'other', labelKey: 'issueTemplateOther' },
];

export function AboutTab() {
  const extras = t().extras!;
  const [selectedTemplate, setSelectedTemplate] = useState<IssueTemplate>('plugin_issue');
  const [submitting, setSubmitting] = useState(false);
  const [version, setVersion] = useState('...');
  const templatePickerRef = useRef<HTMLDivElement>(null);

  const aboutStrings = t().about;

  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      evt.preventDefault();
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await openIssue(selectedTemplate);
    } catch {
      toaster.toast({ title: 'Proton Pulse', body: extras.failedToOpenIssuePage() });
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => registerScreenshotAutomationHandler('about/issue-template-selector', async () => {
    const picker = templatePickerRef.current;
    const button = picker?.querySelector<HTMLElement>('button,[role="button"]');
    button?.click();
  }), []);

  useEffect(() => {
    void getPluginVersionSafe()
      .then(setVersion)
      .catch(() => setVersion('...'));
  }, []);

  return (
    <Focusable onGamepadDirection={handleRootDirection} style={{ padding: 8, fontSize: 12, color: '#ccc' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <BrandLogo size={42} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Proton Pulse</div>
          <div style={{ color: '#888' }}>{`v${version}`}</div>
        </div>
      </div>
      <div style={{ marginBottom: 12, lineHeight: 1.5 }}>
        {aboutStrings.description}
      </div>

      {/* --- Links (below description, above update section) --- */}
      <Focusable
        style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}
        flow-children="horizontal"
      >
        {[
          { label: 'Proton Pulse Website', url: 'https://www.proton-pulse.com' },
          { label: aboutStrings.github, url: 'https://github.com/mdeguzis/decky-proton-pulse' },
          { label: aboutStrings.protondb, url: 'https://www.protondb.com' },
        ].map(({ label, url }) => (
          <Focusable
            key={url}
            onActivate={() => { try { window.open(url, '_blank'); } catch { /* noop */ } }}
            style={{
              color: '#4c9eff',
              padding: '4px 8px',
              borderRadius: 3,
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {label} {'↗'}
          </Focusable>
        ))}
      </Focusable>

      {/* --- Submit Issue --- */}
      <div
        style={{
          borderTop: '1px solid #2a3a4a',
          paddingTop: 14,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, color: '#e8f4ff', marginBottom: 4 }}>
          {aboutStrings.submitIssue}
        </div>
        <div style={{ fontSize: 10, color: '#7a9bb5', marginBottom: 10, lineHeight: 1.4 }}>
          {aboutStrings.submitIssueHint}
        </div>
        <Focusable style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
          <div ref={templatePickerRef} style={{ flex: 1 }}>
            <Dropdown
              rgOptions={ISSUE_TEMPLATES.map((tpl) => ({
                data: tpl.data,
                label: aboutStrings[tpl.labelKey] as string,
              }))}
              selectedOption={selectedTemplate}
              onChange={(opt) => setSelectedTemplate(opt.data as IssueTemplate)}
            />
          </div>
          <DialogButton
            onClick={handleSubmit}
            disabled={submitting}
            style={{ flex: 1, fontSize: 12 }}
          >
            {submitting ? aboutStrings.openingIssue : aboutStrings.submitIssue}
          </DialogButton>
        </Focusable>
      </div>
    </Focusable>
  );
}
