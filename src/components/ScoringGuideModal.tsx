// src/components/ScoringGuideModal.tsx
// Scroll pattern matches LogViewerModal exactly -- confirmed working.
import { useRef } from 'react';
import { ModalRoot, Focusable, DialogButton } from '@decky/ui';
import { GamepadButton, GamepadEvent } from '@decky/ui';
import { RATING_COLORS } from '../lib/reportFormatters';

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
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e8f4ff' }}>How Scoring Works</div>
          <DialogButton onClick={closeModal} style={{ fontSize: 10, padding: '3px 10px', minWidth: 0, width: 'auto' }}>
            Close
          </DialogButton>
        </div>

        {/* scroll container -- flex: 1 + minHeight: 0 inside explicit-height Focusable */}
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: 24 }}>
          <div style={{ fontSize: 11, color: '#7a9bb5', marginBottom: 10 }}>
            Your Yes/No answers determine the rating automatically.
          </div>

          <TierRow tier="platinum" rule="Can install, start, and play. No faults. Works out of the box without any tinkering." />
          <TierRow tier="gold"     rule="Can install, start, and play. No faults. Works but required tinkering (launch options, config, etc.)." />
          <TierRow tier="silver"   rule="Can install, start, and play. Exactly 2 faults reported (e.g. graphical + performance)." />
          <TierRow tier="bronze"   rule="Can install, start, and play. 3 or more faults. Playable but with significant issues." />
          <TierRow tier="borked"   rule="Cannot install, cannot start, cannot begin playing, or overall verdict is No." />

          <div style={{ fontSize: 12, fontWeight: 700, color: '#7a9bb5', marginTop: 14, marginBottom: 4 }}>Fault questions</div>
          <div style={{ fontSize: 11, color: '#c8d4e0', lineHeight: 1.6 }}>
            Each "Yes" to a fault question (performance, graphical, windowing, audio, input, stability, save game, significant bugs) counts as 1 fault. The total determines Silver, Bronze, or Gold.
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: '#7a9bb5', marginTop: 14, marginBottom: 4 }}>Out-of-the-box question</div>
          <div style={{ fontSize: 11, color: '#c8d4e0', lineHeight: 1.6 }}>
            Only shown when verdict is Yes and no faults are reported. Answering Yes elevates Gold to Platinum.
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: '#7a9bb5', marginTop: 14, marginBottom: 4 }}>Quick reference</div>
          <div style={{ fontSize: 11, color: '#c8d4e0', lineHeight: 1.8 }}>
            {'0 faults + out-of-box Yes = Platinum'}<br />
            {'0 faults + out-of-box No  = Gold'}<br />
            {'1 fault                   = Gold'}<br />
            {'2 faults                  = Silver'}<br />
            {'3+ faults                 = Bronze'}<br />
            {"Can't play or verdict No  = Borked"}
          </div>

          <div style={{ fontSize: 12, fontWeight: 700, color: '#7a9bb5', marginTop: 18, marginBottom: 4 }}>How reports are ranked</div>
          <div style={{ fontSize: 11, color: '#c8d4e0', lineHeight: 1.6 }}>
            Each report gets a relevance score so the most useful ones rise to the top. Factors:
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
            Playtime confidence rewards reporters who played 2+ hours -- they are more likely to have encountered real compatibility issues. The bonus scales with how closely their hardware matches yours.
          </div>
        </div>
      </Focusable>
    </ModalRoot>
  );
}
