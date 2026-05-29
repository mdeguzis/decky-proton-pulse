// src/components/ScoringGuideModal.tsx
// Scroll pattern matches LogViewerModal exactly -- confirmed working.
import { useRef } from 'react';
import { ModalRoot, Focusable, DialogButton } from '@decky/ui';
import { GamepadButton, GamepadEvent } from '@decky/ui';
import { RATING_COLORS } from '../lib/reportFormatters';
import scoringInfo from '../data/scoring-info.json';
import { t as i18n } from '../lib/i18n';

const TIER_TEXT_COLOR: Record<string, string> = {
  platinum: '#111', gold: '#111', silver: '#111', bronze: '#fff', borked: '#fff',
};

function TierRow({ tier, rule }: { tier: string; rule: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderBottom: '1px solid #1a2a3a' }}>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 4, flexShrink: 0,
        background: RATING_COLORS[tier] ?? '#555',
        color: TIER_TEXT_COLOR[tier] ?? '#fff',
        letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: 2,
      }}>
        {tier}
      </span>
      <span style={{ fontSize: 11, color: '#c8d4e0', lineHeight: 1.5 }}>{rule}</span>
    </div>
  );
}

export function ScoringGuideModal({ closeModal }: { closeModal?: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const handleGamepadDirection = (e: GamepadEvent) => {
    if (e.detail.button === GamepadButton.DIR_DOWN) scrollRef.current?.scrollBy({ top: 80, behavior: 'smooth' });
    if (e.detail.button === GamepadButton.DIR_UP)   scrollRef.current?.scrollBy({ top: -80, behavior: 'smooth' });
  };

  return (
    <ModalRoot onCancel={closeModal} bAllowFullSize
      className="proton-pulse-scoring-guide-modal"
      modalClassName="proton-pulse-scoring-guide-modal"
    >
      <style>{`
        .proton-pulse-scoring-guide-modal,
        .proton-pulse-scoring-guide-modal > div,
        .proton-pulse-scoring-guide-modal .DialogContent_InnerWidth {
          padding: 0 !important; margin: 0 !important;
          max-width: 100vw !important; width: 100vw !important;
          max-height: 100vh !important;
        }
        .proton-pulse-scoring-guide-modal .ModalPosition { inset: 0 !important; }
      `}</style>

      {/* Focusable at root with explicit height -- matches LogViewerModal pattern exactly */}
      <Focusable
        onGamepadDirection={handleGamepadDirection}
        style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 88px)', padding: '12px 16px 0', boxSizing: 'border-box' }}
      >
        {/* header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexShrink: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e8f4ff' }}>{i18n().extras!.scoringGuideTitle!()}</div>
          <DialogButton onClick={closeModal} style={{ fontSize: 10, padding: '3px 10px', minWidth: 0, width: 'auto' }}>
            {i18n().extras!.scoringGuideClose!()}
          </DialogButton>
        </div>

        {/* scroll container -- flex: 1 + minHeight: 0 inside explicit-height Focusable */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: 24 }}>
          <div style={{ fontSize: 11, color: '#7a9bb5', marginBottom: 10 }}>
            {i18n().extras!.scoringGuideIntro!()}
          </div>

          {scoringInfo.tiers.map(t => (
            <TierRow key={t.name} tier={t.name} rule={t.rule} />
          ))}

          <div style={{ fontSize: 12, fontWeight: 700, color: '#7a9bb5', marginTop: 14, marginBottom: 4 }}>{i18n().extras!.scoringGuideFaultsTitle!()}</div>
          <div style={{ fontSize: 11, color: '#c8d4e0', lineHeight: 1.6 }}>
            {i18n().extras!.scoringGuideFaultsHint1!()}{scoringInfo.faultQuestionsDisplay.join(', ')}{i18n().extras!.scoringGuideFaultsHint2!()}
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: '#7a9bb5', marginTop: 14, marginBottom: 4 }}>{i18n().extras!.scoringGuideOOBTitle!()}</div>
          <div style={{ fontSize: 11, color: '#c8d4e0', lineHeight: 1.6 }}>
            {scoringInfo.outOfBoxNote}
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: '#7a9bb5', marginTop: 14, marginBottom: 4 }}>{i18n().extras!.scoringGuideQuickReference!()}</div>
          <div style={{ fontSize: 11, color: '#c8d4e0', lineHeight: 1.8 }}>
            {scoringInfo.quickReference.map((line, i) => (
              <span key={i}>{line}{i < scoringInfo.quickReference.length - 1 ? <br /> : null}</span>
            ))}
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: '#7a9bb5', marginTop: 18, marginBottom: 4 }}>{i18n().extras!.scoringGuideRankingTitle!()}</div>
          <div style={{ fontSize: 11, color: '#c8d4e0', lineHeight: 1.6 }}>
            {i18n().extras!.scoringGuideRankingIntro!()}
          </div>
          <div style={{ fontSize: 11, color: '#c8d4e0', lineHeight: 1.8, marginTop: 6 }}>
            {'1. Rating -- Platinum=60 pts down to Borked=0'}<br />
            {'2. Recency -- <90 days: +15 | 90-365: +5 | >1yr: -5'}<br />
            {'3. Custom Proton (GE, CachyOS, etc.) -- +10'}<br />
            {'4. Proton version match -- same major: +8 | adjacent: +4'}<br />
            {'5. Playtime confidence -- <1h: +3 | 1-4h: +6 | 4-10h: +9 | 10h+: +12'}<br />
            {'6. GPU/OS/kernel multipliers scale the above total'}<br />
            {'7. Notes sentiment -- positive/negative keywords (+/-10 cap)'}
          </div>
          <div style={{ fontSize: 11, color: '#7a9bb5', marginTop: 8, lineHeight: 1.5 }}>
            {i18n().extras!.scoringGuidePlaytimeConfidence!()}
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: '#7a9bb5', marginTop: 18, marginBottom: 4 }}>{i18n().extras!.scoringGuideDurationAutofill!()}</div>
          <div style={{ fontSize: 11, color: '#c8d4e0', lineHeight: 1.6 }}>
            {scoringInfo.durationAutoFillNote}
          </div>
        </div>
      </Focusable>
    </ModalRoot>
  );
}
