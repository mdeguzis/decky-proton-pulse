// src/lib/issueReport.ts
import { callable } from '@decky/api';
import { Navigation } from '@decky/ui';
import type { SystemInfo } from '../types';

const getSystemInfo = callable<[], SystemInfo>('get_system_info');
const getLogContents = callable<[], string>('get_log_contents');
const getPluginVersion = callable<[], string>('get_plugin_version');

const REPO = 'mdeguzis/decky-proton-pulse';
const MAX_LOG_LINES = 30;

export type IssueTemplate = 'game_report' | 'missing_reports' | 'plugin_issue' | 'other';

function formatSystemInfo(info: SystemInfo, version: string): string {
  const lines = [
    `Plugin Version: ${version}`,
    `GPU: ${info.gpu ?? 'unknown'}`,
    `GPU Vendor: ${info.gpu_vendor ?? 'unknown'}`,
    `CPU: ${info.cpu ?? 'unknown'}`,
    `RAM: ${info.ram_gb != null ? `${info.ram_gb} GB` : 'unknown'}`,
    `Kernel: ${info.kernel ?? 'unknown'}`,
    `Distro: ${info.distro ?? 'unknown'}`,
    `Driver: ${info.driver_version ?? 'unknown'}`,
    `Custom Proton: ${info.proton_custom ?? 'none'}`,
  ];
  return lines.join('\n');
}

function truncateLogs(logs: string): string {
  const lines = logs.split('\n');
  if (lines.length <= MAX_LOG_LINES) return logs;
  return `... (truncated, showing last ${MAX_LOG_LINES} lines) ...\n` + lines.slice(-MAX_LOG_LINES).join('\n');
}

function buildBody(template: IssueTemplate, systemInfo: string, logs: string): string {
  const sysBlock = '```\n' + systemInfo + '\n```';
  const logBlock = logs.trim()
    ? '```\n' + truncateLogs(logs) + '\n```'
    : '_No logs available_';

  switch (template) {
    case 'game_report':
      return [
        '## Game Report',
        '',
        '**Game Name:** ',
        '**Steam AppID:** ',
        '**Issue Type:** <!-- Config does not work / Config causes crash / Wrong Proton version / Missing game / Other -->',
        '',
        '### Description',
        '<!-- What happened and what you expected -->',
        '',
        '',
        '### System Info',
        sysBlock,
        '',
        '### Plugin Logs',
        logBlock,
      ].join('\n');

    case 'missing_reports':
      return [
        '## Missing ProtonDB Reports',
        '',
        '**Game Name:** ',
        '**Steam AppID:** ',
        '**Issue Type:** <!-- No reports at all / Reports exist on ProtonDB but not shown / Reports outdated / Other -->',
        '',
        '### Description',
        '<!-- Any additional context about the missing reports -->',
        '',
        '',
        '### System Info',
        sysBlock,
        '',
        '### Plugin Logs',
        logBlock,
      ].join('\n');

    case 'plugin_issue':
      return [
        '## Plugin Issue',
        '',
        '**Affected Area:** <!-- Config Editor / Manage Configurations / Compatibility Tools / ProtonDB Reports / Settings / UI / Backend / Other -->',
        '',
        '### Description',
        '<!-- What happened and what you expected -->',
        '',
        '',
        '### Steps to Reproduce',
        '1. ',
        '2. ',
        '3. ',
        '',
        '### System Info',
        sysBlock,
        '',
        '### Plugin Logs',
        logBlock,
      ].join('\n');

    case 'other':
      return [
        '## General Feedback',
        '',
        '**Feedback Type:** <!-- General feedback / Feature request / Question / Documentation / Other -->',
        '',
        '### What would you like to share?',
        '<!-- Tell us what is working well, what feels rough, or what you want changed. -->',
        '',
        '',
        '### Affected Area (optional)',
        '<!-- Manage This Game / Manage Configurations / Compatibility Tools / Logs / Settings / About / Other -->',
        '',
        '',
        '### Additional Context',
        '',
        '',
        '### System Info',
        sysBlock,
        '',
        '### Plugin Logs (if relevant)',
        logBlock,
      ].join('\n');
  }
}

const LABELS: Record<IssueTemplate, string> = {
  game_report: 'game-report',
  missing_reports: 'missing-reports',
  plugin_issue: 'bug',
  other: 'other',
};

const TITLES: Record<IssueTemplate, string> = {
  game_report: '[Game Report] ',
  missing_reports: '[Missing Reports] ',
  plugin_issue: '[Bug] ',
  other: '[General Feedback] ',
};

// CEF / Steam Web Helper refuses to open URLs past ~8 KB with a "URL too
// long" bounce. Keep well below that: the browser adds its own headers,
// and github.com may redirect once, both of which eat headroom. Bytes,
// not characters -- the URL is what's counted.
const URL_MAX_BYTES = 6000;

// Rebuild the URL after dropping logs, then (last resort) truncating the
// body. Preserves title + labels so the issue still lands in the right
// bucket even when we had to trim the description.
function buildUrl(title: string, body: string, labels: string): string {
  const params = new URLSearchParams({ title, body, labels });
  return `https://github.com/${REPO}/issues/new?${params.toString()}`;
}

const LOGS_OMITTED_NOTE =
  '_Plugin logs omitted because the pre-filled URL was too long. Paste them from Decky > Developer > Log Viewer._';

export async function openIssue(template: IssueTemplate): Promise<void> {
  const [sysInfo, logs, version] = await Promise.all([
    getSystemInfo().catch(() => ({
      cpu: null, ram_gb: null, gpu: null, gpu_vendor: null,
      driver_version: null, kernel: null, distro: null, proton_custom: null,
    } as SystemInfo)),
    getLogContents().catch(() => ''),
    getPluginVersion().catch(() => 'unknown'),
  ]);

  const systemInfo = formatSystemInfo(sysInfo, version);
  const title = TITLES[template];
  const label = LABELS[template];

  // Try full body first. If it pushes the URL past CEF's limit, drop the
  // logs (they're the biggest variable-size chunk) and leave a note. If
  // still too long, hard-trim the whole body.
  let body = buildBody(template, systemInfo, logs);
  let url = buildUrl(title, body, label);
  if (url.length > URL_MAX_BYTES) {
    body = buildBody(template, systemInfo, '') + '\n\n' + LOGS_OMITTED_NOTE;
    url = buildUrl(title, body, label);
  }
  if (url.length > URL_MAX_BYTES) {
    // Last resort: chop the body until it fits. Leave the trailing note
    // so the reader knows something was cut.
    const trimNote = '\n\n_... body truncated to fit URL length limit ..._';
    const overshoot = url.length - URL_MAX_BYTES + trimNote.length + 32;
    body = body.slice(0, Math.max(0, body.length - overshoot)) + trimNote;
    url = buildUrl(title, body, label);
  }
  Navigation.NavigateToExternalWeb(url);
}
