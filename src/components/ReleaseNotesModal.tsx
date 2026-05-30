// Release notes browser modal. Mirrors Steam Big Picture's full-screen
// patch-notes overlay: a wide bordered card with a breadcrumb-style
// metadata strip on top, a large version title, scrollable body, and a
// footer hint row showing the gamepad bindings.
//
// Browsing history: the modal loads the N most recent releases on open
// and lets the user page left/right through them with the d-pad shoulder
// arrows (L1/R1 or DIR_LEFT/RIGHT at the root Focusable). A small
// "n of N" counter on the bottom-right of the metadata strip shows where
// you are in the stack.
//
// Renders blocks (heading / list-item / paragraph) via useFocusableScroll
// so up/down scroll the focused row into viewport-center -- same feel as
// SystemRequirementsTab and AnalysisTab

import { useEffect, useState } from 'react';
import {
  ModalRoot, Focusable, DialogButton, showModal, GamepadButton, Navigation,
} from '@decky/ui';
// GamepadButton + Navigation: GamepadButton drives the direction handler
// for left/right release browsing; Navigation lets us open the GitHub
// release page in the system browser when the user clicks the footer
// "Open on GitHub" button
import type { GamepadEvent } from '@decky/ui';
import { callable } from '@decky/api';
import { useFocusableScroll } from '../lib/useFocusableScroll';
import { logFrontendEvent } from '../lib/logger';
import { t } from '../lib/i18n';

const PpDialogButton = DialogButton as React.ComponentType<
  React.ComponentProps<typeof DialogButton> & {
    onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
    onBlur?: () => void;
  }
>;

interface ReleaseRow {
  version: string;
  name: string;
  body: string;
  published_at: string;
  prerelease: boolean;
  html_url: string;
}

const listReleases = callable<[number, boolean], { success: boolean; releases: ReleaseRow[]; error?: string }>(
  'list_releases',
);

// Break the GitHub markdown body into renderable chunks. Bullets keep their
// text only; we drop the leading "- "/"* " since the row layout already
// provides the visual separation. Headings render bigger + bolder
function parseBody(body: string): Array<{ kind: 'heading' | 'item' | 'text'; text: string }> {
  const out: Array<{ kind: 'heading' | 'item' | 'text'; text: string }> = [];
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let buffer = '';
  const flush = () => {
    if (buffer.trim()) {
      out.push({ kind: 'text', text: buffer.trim() });
      buffer = '';
    }
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) { flush(); out.push({ kind: 'heading', text: heading[1] }); continue; }
    const item = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (item) { flush(); out.push({ kind: 'item', text: item[1] }); continue; }
    buffer += (buffer ? ' ' : '') + line.trim();
  }
  flush();
  return out;
}

// Format the GitHub publish date for the header strip. Steam uses
// "Fri, May 29"-style short dates; we follow suit with the user's locale
function formatPublishedDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    });
  } catch { return ''; }
}

interface Props {
  // The release the user clicked into -- shown first. If list_releases
  // returns more, we splice this into the front so it's index 0
  initial: ReleaseRow;
  closeModal?: () => void;
}

function ReleaseNotesModal({ initial, closeModal }: Props) {
  const [releases, setReleases] = useState<ReleaseRow[]>([initial]);
  const [idx, setIdx] = useState(0);
  const { onRowFocus, onRowBlur, focusBorder } = useFocusableScroll();

  // Load the rest of the release history once the modal is open so the
  // user can browse left/right. Drop the rolling 'developer' tag (the
  // backend already does this) and de-dup against the initial entry by
  // version so we dont show it twice
  useEffect(() => {
    void (async () => {
      try {
        const res = await listReleases(10, true);
        if (!res?.success || !Array.isArray(res.releases)) return;
        const list = res.releases.filter((r) => r.version !== initial.version);
        setReleases([initial, ...list]);
        void logFrontendEvent('DEBUG', 'ReleaseNotesModal: history loaded', {
          totalCount: 1 + list.length,
        });
      } catch (e) {
        void logFrontendEvent('WARNING', 'ReleaseNotesModal: history load failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, [initial]);

  const current = releases[idx] ?? initial;
  const blocks = parseBody(current.body || '');
  const total = releases.length;
  const canPrev = idx < total - 1; // older releases live further down the list
  const canNext = idx > 0;

  // Root direction handler: B is already wired through ModalRoot's
  // onCancel. We use DIR_LEFT / DIR_RIGHT to page through history and
  // preventDefault so the gamepad event doesnt leak to whatever Steam UI
  // is behind the modal
  const handleRootDirection = (evt: GamepadEvent) => {
    if (evt.detail.button === GamepadButton.DIR_LEFT) {
      evt.preventDefault();
      if (canPrev) setIdx((i) => i + 1);
    } else if (evt.detail.button === GamepadButton.DIR_RIGHT) {
      evt.preventDefault();
      if (canNext) setIdx((i) => i - 1);
    }
  };

  // Click handler for the "Open on GitHub" footer action. Steam binds this
  // to Y on its patch-notes page; Focusable doesnt expose a typed
  // onGamepadButton prop so we use a click target instead (still focusable,
  // so D-pad reaches it). Could be wired to Y later via FocusNavController
  // poll pattern (see src/patches/searchResultsHint.tsx)
  const openOnGitHub = () => {
    if (!current.html_url) return;
    try { Navigation.NavigateToExternalWeb(current.html_url); } catch { /* ignore */ }
  };

  const publishedLabel = formatPublishedDate(current.published_at);
  const channelLabel = current.prerelease
    ? t().extras!.updateChannelPreRelease!()
    : t().extras!.updateChannelRelease!();

  return (
    <ModalRoot onCancel={closeModal}>
      <Focusable
        onGamepadDirection={handleRootDirection}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '92vw',
          maxWidth: 1100,
          height: '85vh',
          padding: 0,
          background: '#0f1822',
          border: '1px solid rgba(102, 192, 244, 0.18)',
          borderRadius: 6,
        }}
      >
        {/* --- Metadata strip --- */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 22px 10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#9bb5cc' }}>
            <span style={{
              fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
              color: '#e0ebf3',
            }}>
              {t().extras!.releaseNotes!()}
            </span>
            {publishedLabel && (
              <>
                <span style={{ color: '#3d556a' }}>•</span>
                <span style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {t().extras!.releaseNotesPosted!()} {publishedLabel}
                </span>
              </>
            )}
          </div>
          <div style={{
            fontSize: 11, fontWeight: 700,
            color: current.prerelease ? '#f6b347' : '#9bb5cc',
            textTransform: 'uppercase', letterSpacing: '0.08em',
          }}>
            {channelLabel}
            {total > 1 && (
              <span style={{ color: '#3d556a', marginLeft: 14 }}>
                {idx + 1} / {total}
              </span>
            )}
          </div>
        </div>

        {/* --- Title --- */}
        <div style={{ padding: '0 22px 10px' }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#ffffff', lineHeight: 1.15 }}>
            {current.name || (/^\d/.test(current.version) ? `v${current.version}` : current.version)}
          </div>
        </div>

        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '0 22px' }} />

        {/* --- Body --- */}
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 0' }}>
          {blocks.length === 0 ? (
            <div style={{ padding: '24px 28px', color: '#9bb5cc', fontSize: 14, textAlign: 'center' }}>
              {t().extras!.releaseNotesEmpty!()}
            </div>
          ) : blocks.map((b, i) => {
            const id = `b-${idx}-${i}`;
            if (b.kind === 'heading') {
              return (
                <PpDialogButton key={id} onClick={() => {}}
                  onFocus={onRowFocus(id)} onBlur={onRowBlur}
                  style={{
                    width: '100%', textAlign: 'left',
                    background: 'transparent', border: 'none', boxShadow: 'none',
                    padding: '18px 28px 6px',
                    fontSize: 17, fontWeight: 700, color: '#e8f4ff',
                    letterSpacing: '0.01em',
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
                    padding: '7px 32px 7px 44px',
                    fontSize: 14, color: '#dbe7ef', lineHeight: 1.55,
                    position: 'relative',
                    borderRight: focusBorder(id),
                  }}
                >
                  <span style={{
                    position: 'absolute', left: 26, top: 16,
                    width: 6, height: 6, borderRadius: '50%',
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
                  padding: '8px 28px',
                  fontSize: 14, color: '#c8dcea', lineHeight: 1.55,
                  borderRight: focusBorder(id),
                }}
              >{b.text}</PpDialogButton>
            );
          })}

          <div style={{ height: 40, flexShrink: 0 }} aria-hidden="true" />
        </div>

        {/* --- Footer: nav hint + action buttons --- */}
        <Focusable style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 22px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          gap: 12,
        }}>
          <div style={{
            color: '#8aa3b6',
            fontSize: 11,
            letterSpacing: '0.04em',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            {total > 1 && (
              <>
                <Glyph>←</Glyph><Glyph>→</Glyph> {t().extras!.releaseNotesNavHint!()}
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {current.html_url && (
              <DialogButton onClick={openOnGitHub} style={{ minWidth: 180, fontSize: 12 }}>
                {t().extras!.releaseNotesOpenOnGitHub!()}
              </DialogButton>
            )}
            <DialogButton onClick={closeModal} style={{ minWidth: 140, fontSize: 12 }}>
              {t().common.close}
            </DialogButton>
          </div>
        </Focusable>
      </Focusable>
    </ModalRoot>
  );
}

// Decorative glyph badge to render gamepad button labels inline with text.
// Steam uses small dark-pill icons for these in its own patch-notes footer
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      display: 'inline-block',
      minWidth: 18,
      padding: '2px 6px',
      borderRadius: 10,
      background: 'rgba(255,255,255,0.08)',
      color: '#e8f4ff',
      fontSize: 10,
      fontWeight: 700,
      textAlign: 'center',
      lineHeight: 1.2,
      marginRight: 4,
    }}>
      {children}
    </span>
  );
}

export function showReleaseNotesModal(version: string, body: string, releaseUrl?: string, publishedAt?: string, isPrerelease = false): void {
  const initial: ReleaseRow = {
    version,
    name: '',
    body,
    published_at: publishedAt ?? '',
    prerelease: isPrerelease,
    html_url: releaseUrl ?? '',
  };
  const modal = showModal(
    <ReleaseNotesModal
      initial={initial}
      closeModal={() => modal?.Close()}
    />,
  );
}
