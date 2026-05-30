// Modal that surfaces the GitHub release notes for the version the user is
// about to install. Pattern mirrors Steam Big Picture's "Software Updates"
// box on the System Settings page: a bordered card with the version/date
// header, then a scrollable body. D-pad up/down scrolls through paragraphs
// thanks to useFocusableScroll -- each paragraph is its own focusable row
// so the focus indicator advances and the page scrolls with it.

import { ModalRoot, Focusable, DialogButton, showModal, GamepadButton } from '@decky/ui';
import type { GamepadEvent } from '@decky/ui';
import { useFocusableScroll } from '../lib/useFocusableScroll';
import { t } from '../lib/i18n';

// Cast for typed onFocus/onBlur on DialogButton -- see SystemRequirementsTab
const PpDialogButton = DialogButton as React.ComponentType<
  React.ComponentProps<typeof DialogButton> & {
    onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
    onBlur?: () => void;
  }
>;

// Break the markdown body into paragraph-sized chunks. We dont need full
// markdown parsing -- the notes are line-based bullet lists with the odd
// heading, and rendering them as focusable rows is what we want anyway so
// each row can be scrolled to on focus. Drop the leading "- " or "* " of
// list items since the row layout already provides visual separation
function parseBody(body: string): Array<{ kind: 'heading' | 'item' | 'text' | 'spacer'; text: string }> {
  const out: Array<{ kind: 'heading' | 'item' | 'text' | 'spacer'; text: string }> = [];
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let buffer = '';
  const flushParagraph = () => {
    if (buffer.trim()) {
      out.push({ kind: 'text', text: buffer.trim() });
      buffer = '';
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    const headingMatch = /^#{1,6}\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushParagraph();
      out.push({ kind: 'heading', text: headingMatch[1] });
      continue;
    }
    const listMatch = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (listMatch) {
      flushParagraph();
      out.push({ kind: 'item', text: listMatch[1] });
      continue;
    }
    buffer += (buffer ? ' ' : '') + line.trim();
  }
  flushParagraph();
  return out;
}

interface Props {
  version: string;
  body: string;
  releaseUrl?: string;
  closeModal?: () => void;
}

function ReleaseNotesModal({ version, body, releaseUrl: _releaseUrl, closeModal }: Props) {
  const { onRowFocus, onRowBlur, focusBorder } = useFocusableScroll();
  const blocks = parseBody(body || '');

  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) evt.preventDefault();
  };

  return (
    <ModalRoot onCancel={closeModal}>
      <Focusable
        onGamepadDirection={handleRootDirection}
        style={{
          display: 'flex',
          flexDirection: 'column',
          minWidth: 720,
          maxWidth: 880,
          maxHeight: '80vh',
          padding: 0,
        }}
      >
        {/* Header: title + version. Sticky-ish via background and a thin
            divider so the scroll body stays visually anchored below */}
        <div style={{
          padding: '14px 18px 10px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <div style={{ fontSize: 11, color: '#7a9bb5', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            {t().extras!.releaseNotes!()}
          </div>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#e8f4ff' }}>
            {/^\d/.test(version) ? `v${version}` : version}
          </div>
        </div>

        {/* Scrollable body. Each block is focusable so D-pad up/down scrolls
            through them via useFocusableScroll's scrollIntoView behaviour */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 0 4px' }}>
          {blocks.length === 0 ? (
            <div style={{ padding: '18px 22px', color: '#9db0c4', fontSize: 12, textAlign: 'center' }}>
              {t().extras!.releaseNotesEmpty!()}
            </div>
          ) : blocks.map((b, i) => {
            const id = `block-${i}`;
            if (b.kind === 'heading') {
              return (
                <PpDialogButton key={id} onClick={() => {}}
                  onFocus={onRowFocus(id)} onBlur={onRowBlur}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: 'transparent', border: 'none', boxShadow: 'none',
                    padding: '14px 18px 4px',
                    fontSize: 13, fontWeight: 700, color: '#c8dcea',
                    letterSpacing: '0.02em',
                    borderRight: focusBorder(id),
                  }}
                >{b.text}</PpDialogButton>
              );
            }
            if (b.kind === 'item') {
              return (
                <PpDialogButton key={id} onClick={() => {}}
                  onFocus={onRowFocus(id)} onBlur={onRowBlur}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: 'transparent', border: 'none', boxShadow: 'none',
                    padding: '6px 22px 6px 28px',
                    fontSize: 12, color: '#e8f4ff', lineHeight: 1.45,
                    position: 'relative',
                    borderRight: focusBorder(id),
                  }}
                >
                  <span style={{
                    position: 'absolute', left: 14, top: 9,
                    width: 4, height: 4, borderRadius: '50%',
                    background: '#7a9bb5',
                  }} />
                  {b.text}
                </PpDialogButton>
              );
            }
            return (
              <PpDialogButton key={id} onClick={() => {}}
                onFocus={onRowFocus(id)} onBlur={onRowBlur}
                style={{
                  width: '100%', textAlign: 'left',
                  background: 'transparent', border: 'none', boxShadow: 'none',
                  padding: '6px 22px',
                  fontSize: 12, color: '#c8dcea', lineHeight: 1.45,
                  borderRight: focusBorder(id),
                }}
              >{b.text}</PpDialogButton>
            );
          })}

          {/* Bottom spacer so the last block can scroll past the footer */}
          <div style={{ height: 40, flexShrink: 0 }} aria-hidden="true" />
        </div>

        {/* Footer action */}
        <div style={{
          padding: '10px 18px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <DialogButton onClick={closeModal} style={{ minWidth: 160 }}>
            {t().common.close}
          </DialogButton>
        </div>
      </Focusable>
    </ModalRoot>
  );
}

export function showReleaseNotesModal(version: string, body: string, releaseUrl?: string): void {
  const modal = showModal(
    <ReleaseNotesModal
      version={version}
      body={body}
      releaseUrl={releaseUrl}
      closeModal={() => modal?.Close()}
    />,
  );
}
