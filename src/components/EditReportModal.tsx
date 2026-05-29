// src/components/EditReportModal.tsx
import { useRef, useState } from 'react';
import {
  ModalRoot,
  PanelSection,
  PanelSectionRow,
  DialogButton,
  DropdownItem,
  showModal,
} from '@decky/ui';
import { ScoringGuideModal } from './ScoringGuideModal';
import type { DisplayReportCard } from './ReportCard';
import type { EditedReportEntry } from './tabs/ConfigureTab';
import { logFrontendEvent } from '../lib/logger';
import { t } from '../lib/i18n';
import { deriveRating, FAULT_KEYS, inferResponsesFromRating, type ReportResponses, type YesNo } from '../lib/scoring';
import { RATING_COLORS } from '../lib/reportFormatters';

export interface VersionOption {
  value: string;
  displayName: string;
  installed: boolean;
  managed: boolean;
}

import { formatProtonLabel } from '../lib/reportFormatters';

export function buildVersionOptions(
  releases: { tag_name: string }[],
  installedTools: { directory_name: string; display_name: string; internal_name: string }[],
): VersionOption[] {
  const installedTagSet = new Set<string>();
  for (const tool of installedTools) {
    if (tool.internal_name) installedTagSet.add(tool.internal_name.toLowerCase());
    if (tool.directory_name) installedTagSet.add(tool.directory_name.toLowerCase());
  }
  const isInstalled = (tag: string) => installedTagSet.has(tag.toLowerCase());
  const releaseOptions: VersionOption[] = releases.map((r) => ({
    value: r.tag_name, displayName: formatProtonLabel(r.tag_name),
    installed: isInstalled(r.tag_name), managed: true,
  }));
  const geLatest = installedTools.find(
    (t) => t.directory_name === 'Proton-GE-Latest' || (t as any).managed_slot === 'latest',
  );
  const geLatestOption: VersionOption[] = geLatest
    ? [{ value: 'Proton-GE-Latest', displayName: 'Proton-GE-Latest', installed: true, managed: true }]
    : [];
  const releaseTagSet = new Set(releases.map((r) => r.tag_name.toLowerCase()));
  const extraInstalled: VersionOption[] = installedTools
    .filter((t) =>
      !releaseTagSet.has((t.internal_name || t.directory_name).toLowerCase())
      && t.directory_name !== 'Proton-GE-Latest'
      && (t as any).managed_slot !== 'latest',
    )
    .map((t) => ({
      value: t.internal_name || t.directory_name, displayName: t.display_name || t.directory_name,
      installed: true, managed: false,
    }));
  const combined = [...geLatestOption, ...extraInstalled, ...releaseOptions];
  combined.sort((a, b) => (a.installed !== b.installed ? (a.installed ? -1 : 1) : 0));
  return combined;
}

export function VersionOptionLabel({ name, installed, managed }: { name: string; installed: boolean; managed: boolean }) {
  const statusLabel = installed ? t().detail.installed : managed ? t().detail.notInstalled : t().detail.valveProton;
  const statusColor = installed ? '#4caf50' : managed ? '#f59e0b' : '#4a6a8a';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 8 }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: statusColor, flexShrink: 0, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {statusLabel}
      </span>
    </div>
  );
}

const TIER_TEXT_COLOR: Record<string, string> = {
  platinum: '#111', gold: '#111', silver: '#111', bronze: '#fff', borked: '#fff',
};

// Function so labels stay reactive to the active language
const yesNoOptions = () => [
  { data: '', label: '-' },
  { data: 'yes', label: t().common.yes },
  { data: 'no', label: t().common.no },
];

const FAULT_LABEL_KEY: Record<string, keyof ReturnType<typeof t>['nativeReport']> = {
  performanceFaults:  'faultPerformance',
  graphicalFaults:    'faultGraphical',
  windowingFaults:    'faultWindowing',
  audioFaults:        'faultAudio',
  inputFaults:        'faultInput',
  stabilityFaults:    'faultStability',
  saveGameFaults:     'faultSaveGame',
  significantBugs:    'faultSignificantBugs',
};

function yesNoVal(v: YesNo | null | undefined): string { return v ?? ''; }
function asYesNo(v: string): YesNo | null { return v === 'yes' || v === 'no' ? v : null; }

export interface EditReportModalProps {
  closeModal?: () => void;
  report: DisplayReportCard;
  onSave: (entry: EditedReportEntry) => void;
}

export function EditReportModal({ closeModal, report, onSave }: EditReportModalProps) {
  const strings = t();

  const initial: ReportResponses = (report.formResponses as ReportResponses | null | undefined)
    ?? inferResponsesFromRating(report.rating);

  const [canInstall, setCanInstall] = useState<YesNo | null>(initial.canInstall ?? null);
  const [canStart, setCanStart]     = useState<YesNo | null>(initial.canStart ?? null);
  const [canPlay, setCanPlay]       = useState<YesNo | null>(initial.canPlay ?? null);
  const [verdict, setVerdict]       = useState<YesNo | null>(initial.verdict ?? null);
  const [verdictOob, setVerdictOob] = useState<YesNo | null>(initial.verdictOob ?? null);
  const [faults, setFaults]         = useState<Record<string, YesNo | null>>(() => {
    const out: Record<string, YesNo | null> = {};
    for (const k of FAULT_KEYS) out[k] = initial[k] ?? null;
    return out;
  });
  const [scoringBtnFocused, setScoringBtnFocused] = useState(false);

  // One ref per question in display order: canInstall, canStart, canPlay, ...FAULT_KEYS, verdict, verdictOob
  const questionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollToNext = (idx: number) => {
    setTimeout(() => {
      const next = questionRefs.current[idx + 1];
      const container = scrollContainerRef.current;
      if (!next || !container) return;
      const nextTop = next.getBoundingClientRect().top;
      const containerTop = container.getBoundingClientRect().top;
      container.scrollBy({ top: nextTop - containerTop - 20, behavior: 'smooth' });
      next.querySelector<HTMLElement>('button, [role="button"]')?.focus();
    }, 300);
  };

  const currentResponses: ReportResponses = {
    canInstall, canStart, canPlay, verdict, verdictOob,
    ...Object.fromEntries(FAULT_KEYS.map((k) => [k, faults[k]])),
  };
  const displayRating = deriveRating(currentResponses) ?? report.rating;

  const handleSave = () => {
    void logFrontendEvent('INFO', 'EditReport: Saving response edits', { rating: displayRating });
    onSave({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      label: '',
      baseReportKey: `${report.timestamp}_${report.protonVersion}`,
      report: {
        appId: report.appId,
        cpu: report.cpu,
        duration: report.duration,
        gpu: report.gpu,
        gpuDriver: report.gpuDriver,
        kernel: report.kernel,
        notes: report.notes,
        os: report.os,
        protonVersion: report.protonVersion,
        ram: report.ram,
        rating: displayRating ?? report.rating,
        timestamp: report.timestamp,
        title: report.title,
        formResponses: currentResponses,
      },
      updatedAt: Date.now(),
    });
    closeModal?.();
  };

  return (
    <ModalRoot
      onCancel={closeModal}
      bAllowFullSize
      className="proton-pulse-edit-report-modal"
      modalClassName="proton-pulse-edit-report-modal"
    >
      <style>{`
        .proton-pulse-edit-report-modal,
        .proton-pulse-edit-report-modal > div,
        .proton-pulse-edit-report-modal .DialogContent_InnerWidth {
          padding: 0 !important; margin: 0 !important;
          max-width: 100vw !important; width: 100vw !important;
          max-height: 100vh !important;
        }
        .proton-pulse-edit-report-modal .ModalPosition { inset: 0 !important; }
      `}</style>
      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 40px)' }}>
        {/* header */}
        <div style={{ flexShrink: 0, padding: '10px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #2a3a4a' }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e8f4ff' }}>{t().extras!.reportFormEditResponsesTitle!()}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
              background: RATING_COLORS[displayRating ?? 'borked'] ?? '#555',
              color: TIER_TEXT_COLOR[displayRating ?? 'borked'] ?? '#fff',
              letterSpacing: '0.05em', textTransform: 'uppercase',
            }}>
              {displayRating ?? '-'}
            </span>
            <div
              onFocus={() => setScoringBtnFocused(true)}
              onBlur={() => setScoringBtnFocused(false)}
              style={{
                borderRadius: 4,
                border: `1px solid ${scoringBtnFocused ? '#7ec8f8' : 'transparent'}`,
                boxShadow: scoringBtnFocused ? '0 0 0 2px #7ec8f8, 0 0 8px #3a8fd0' : 'none',
                transition: 'box-shadow 0.15s, border-color 0.15s',
              }}
            >
              <DialogButton
                onClick={() => showModal(<ScoringGuideModal />)}
                style={{ fontSize: 11, padding: '2px 8px', minWidth: 0, width: 'auto', fontWeight: 700, letterSpacing: '0.03em', background: '#1e4a7a', color: '#7ec8f8', border: '1px solid #2a6aaa' }}
              >
                {t().extras!.scoringGuideTitle!()}
              </DialogButton>
            </div>
          </div>
        </div>

        {/* scrollable body */}
        <div ref={scrollContainerRef} style={{ flex: 1, overflowY: 'auto', padding: '0 16px' }}>
          <PanelSection>
            {/* Install & Startup */}
            <PanelSectionRow>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#7a9bb5', paddingTop: 8 }}>{t().extras!.reportFormInstallStartupSection!()}</div>
            </PanelSectionRow>
            <PanelSectionRow>
              <div ref={(el) => { questionRefs.current[0] = el; }}>
                <DropdownItem label={t().extras!.reportFormInstallQuestion!()} rgOptions={yesNoOptions()} selectedOption={yesNoVal(canInstall)} onChange={(opt) => { setCanInstall(asYesNo(opt.data as string)); scrollToNext(0); }} />
              </div>
            </PanelSectionRow>
            <PanelSectionRow>
              <div ref={(el) => { questionRefs.current[1] = el; }}>
                <DropdownItem label={t().extras!.reportFormStartupQuestion!()} rgOptions={yesNoOptions()} selectedOption={yesNoVal(canStart)} onChange={(opt) => { setCanStart(asYesNo(opt.data as string)); scrollToNext(1); }} />
              </div>
            </PanelSectionRow>
            <PanelSectionRow>
              <div ref={(el) => { questionRefs.current[2] = el; }}>
                <DropdownItem label={t().extras!.reportFormPlayQuestion!()} rgOptions={yesNoOptions()} selectedOption={yesNoVal(canPlay)} onChange={(opt) => { setCanPlay(asYesNo(opt.data as string)); scrollToNext(2); }} />
              </div>
            </PanelSectionRow>

            {/* Technical Details */}
            <PanelSectionRow>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#7a9bb5', paddingTop: 8 }}>{t().extras!.reportFormTechnicalDetails!()}</div>
            </PanelSectionRow>
            {FAULT_KEYS.map((k, i) => (
              <PanelSectionRow key={k}>
                <div ref={(el) => { questionRefs.current[3 + i] = el; }}>
                  <DropdownItem
                    label={strings.nativeReport[FAULT_LABEL_KEY[k]]}
                    rgOptions={yesNoOptions()}
                    selectedOption={yesNoVal(faults[k])}
                    onChange={(opt) => { setFaults((prev) => ({ ...prev, [k]: asYesNo(opt.data as string) })); scrollToNext(3 + i); }}
                  />
                </div>
              </PanelSectionRow>
            ))}

            {/* Verdict — index 3 + FAULT_KEYS.length */}
            <PanelSectionRow>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#7a9bb5', paddingTop: 8 }}>{t().extras!.reportFormVerdictSection!()}</div>
            </PanelSectionRow>
            <PanelSectionRow>
              <div ref={(el) => { questionRefs.current[3 + FAULT_KEYS.length] = el; }}>
                <DropdownItem label={strings.nativeReport.verdictQuestion} rgOptions={yesNoOptions()} selectedOption={yesNoVal(verdict)} onChange={(opt) => { setVerdict(asYesNo(opt.data as string)); scrollToNext(3 + FAULT_KEYS.length); }} />
              </div>
            </PanelSectionRow>
            {verdict === 'yes' && Object.values(faults).every((v) => v !== 'yes') && (
              <PanelSectionRow>
                <div ref={(el) => { questionRefs.current[3 + FAULT_KEYS.length + 1] = el; }}>
                  <DropdownItem label={t().extras!.reportFormOutOfBoxQuestion!()} rgOptions={yesNoOptions()} selectedOption={yesNoVal(verdictOob)} onChange={(opt) => setVerdictOob(asYesNo(opt.data as string))} />
                </div>
              </PanelSectionRow>
            )}
          </PanelSection>
        </div>

        {/* footer */}
        <div style={{ flexShrink: 0, padding: '8px 16px', borderTop: '1px solid #2a3a4a' }}>
          <DialogButton onClick={handleSave}>{strings.editReport.saveEdits}</DialogButton>
        </div>
      </div>
    </ModalRoot>
  );
}
