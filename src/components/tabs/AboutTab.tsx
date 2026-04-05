// src/components/tabs/AboutTab.tsx

import { useState } from 'react';
import { Focusable, DialogButton, Dropdown, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { toaster } from '@decky/api';
import { BrandLogo } from '../BrandLogo';
import { t } from '../../lib/i18n';
import { openIssue, type IssueTemplate } from '../../lib/issueReport';

const ISSUE_TEMPLATES: { data: IssueTemplate; labelKey: keyof ReturnType<typeof t>['about'] }[] = [
  { data: 'game_report', labelKey: 'issueTemplateGameReport' },
  { data: 'missing_reports', labelKey: 'issueTemplateMissingReports' },
  { data: 'plugin_issue', labelKey: 'issueTemplatePluginIssue' },
  { data: 'other', labelKey: 'issueTemplateOther' },
];

export function AboutTab() {
  const [selectedTemplate, setSelectedTemplate] = useState<IssueTemplate>('plugin_issue');
  const [submitting, setSubmitting] = useState(false);

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
      toaster.toast({ title: 'Proton Pulse', body: 'Failed to open issue page.' });
    } finally {
      setSubmitting(false);
    }
  };

  const aboutStrings = t().about;

  return (
    <Focusable onGamepadDirection={handleRootDirection} style={{ padding: 8, fontSize: 12, color: '#ccc' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <BrandLogo size={42} />
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Proton Pulse</div>
          <div style={{ color: '#888' }}>v0.1.0</div>
        </div>
      </div>
      <div style={{ marginBottom: 16, lineHeight: 1.5 }}>
        {aboutStrings.description}
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        {[
          { label: aboutStrings.github, url: 'https://github.com/mdeguzis/decky-proton-pulse' },
          { label: aboutStrings.protondb, url: 'https://www.protondb.com' },
        ].map(({ label, url }) => (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#4c9eff', textDecoration: 'none' }}
          >
            {label} ↗
          </a>
        ))}
      </div>

      {/* ── Submit Issue ── */}
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
        <Focusable style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ flex: 1 }}>
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
            style={{ minWidth: 100, padding: '6px 16px', fontSize: 12 }}
          >
            {submitting ? aboutStrings.openingIssue : aboutStrings.submitIssue}
          </DialogButton>
        </Focusable>
      </div>
    </Focusable>
  );
}
