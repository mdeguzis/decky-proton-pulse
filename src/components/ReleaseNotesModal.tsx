// Release notes browser modal. Mirrors Decky Loader's own patch-notes
// browser (frontend/src/components/settings/pages/general/Updater.tsx)
// which is itself styled after Steam Big Picture's "Software Updates"
// patch-notes overlay.
//
// Architecture:
//   - <Carousel> from @decky/ui handles left/right paging natively. Each
//     release is a column; shoulder buttons (L1/R1) page through them
//     with the same animated focus rings Steam uses for game library
//     carousels. We dont have to wire DIR_LEFT / DIR_RIGHT manually
//   - Each column renders the metadata strip + title + parsed body in a
//     scrollable <Focusable>. Inside the body, useFocusableScroll keeps
//     up/down D-pad scrolling smooth (focused row centers in viewport)
//   - findSP() returns the Steam UI window, used to size each carousel
//     column to the BPM viewport
//
// Callers either pass an `initial` release (when the user clicked the
// Release Notes button from an active update), or pass nothing -- the
// modal then loads the 10 most recent releases and starts at index 0

import { useEffect, useState } from 'react';
import {
  Carousel, ModalRoot, Focusable, DialogButton, Navigation, showModal, findSP,
} from '@decky/ui';
import { callable } from '@decky/api';
import { useFocusableScroll } from '../lib/useFocusableScroll';
import { formatVersion } from '../lib/formatVersion';
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

function parseBody(body: string): Array<{ kind: 'heading' | 'item' | 'text'; text: string }> {
  const out: Array<{ kind: 'heading' | 'item' | 'text'; text: string }> = [];
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let buffer = '';
  const flush = () => {
    if (buffer.trim()) { out.push({ kind: 'text', text: buffer.trim() }); buffer = ''; }
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

function formatPublishedDate(iso: string): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: 'short', month: 'short', day: 'numeric',
    });
  } catch { return ''; }
}

// Render one release's full content (header + body) -- one carousel column
function ReleaseColumn({ release, total, idx }: { release: ReleaseRow; total: number; idx: number }) {
  const { onRowFocus, onRowBlur, focusBorder } = useFocusableScroll();
  const blocks = parseBody(release.body || '');
  const publishedLabel = formatPublishedDate(release.published_at);
  const channelLabel = release.prerelease
    ? t().extras!.updateChannelPreRelease!()
    : t().extras!.updateChannelRelease!();

  return (
    <Focusable style={{
      // No background or border here -- the outer ModalRoot Focusable wraps
      // this column with the chrome. Adding our own would double-frame
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      padding: 0,
    }}>
      {/* metadata strip */}
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
          }}>{t().extras!.releaseNotes!()}</span>
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
          color: release.prerelease ? '#f6b347' : '#9bb5cc',
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

      {/* title */}
      <div style={{ padding: '0 22px 10px' }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: '#ffffff', lineHeight: 1.15 }}>
          {release.name || formatVersion(release.version)}
        </div>
      </div>

      <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '0 22px' }} />

      {/* scrollable body */}
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
    </Focusable>
  );
}

interface Props {
  initial?: ReleaseRow;
  closeModal?: () => void;
}

function ReleaseNotesModal({ initial, closeModal }: Props) {
  const [releases, setReleases] = useState<ReleaseRow[] | null>(initial ? [initial] : null);
  const SP = findSP();

  // Load the most recent N releases on mount. If we have an initial entry,
  // splice it in at index 0 so the user lands on the version they clicked.
  // De-dup by version since the active update is also in list_releases
  useEffect(() => {
    void (async () => {
      try {
        const res = await listReleases(10, true);
        if (!res?.success || !Array.isArray(res.releases)) {
          if (!initial) setReleases([]);
          return;
        }
        const fetched = res.releases;
        if (initial) {
          const rest = fetched.filter((r) => r.version !== initial.version);
          setReleases([initial, ...rest]);
        } else {
          setReleases(fetched);
        }
        void logFrontendEvent('DEBUG', 'ReleaseNotesModal: history loaded', {
          totalCount: fetched.length + (initial ? 1 : 0),
          startedWithInitial: !!initial,
        });
      } catch (e) {
        if (!initial) setReleases([]);
        void logFrontendEvent('WARNING', 'ReleaseNotesModal: history load failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, [initial]);

  // Modal sizing. Outer card is ~90% of the BPM viewport so the ModalRoot
  // border frames it cleanly. The carousel column fills the inside of
  // that card (minus a small inset so the focus ring on the column has
  // room to render without clipping)
  const outerW = Math.max(720, Math.min(SP.innerWidth - SP.innerWidth * 0.08, 1280));
  const outerH = Math.max(420, SP.innerHeight - 80);
  // Carousel column = outer card width minus modal padding. Don't subtract
  // for borders since the inner column no longer draws its own frame
  const columnW = outerW - 16;
  const itemH = outerH - 64; // 64 = footer height (gap for action buttons)

  if (!releases) {
    return (
      <ModalRoot onCancel={closeModal}>
        <Focusable style={{ width: 720, height: 360, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <DialogButton onClick={() => {}} style={{ position: 'absolute', width: 1, height: 1, padding: 0, border: 'none', clip: 'rect(0 0 0 0)' }}>...</DialogButton>
          <div style={{ color: '#9bb5cc' }}>...</div>
        </Focusable>
      </ModalRoot>
    );
  }

  if (releases.length === 0) {
    return (
      <ModalRoot onCancel={closeModal}>
        <Focusable style={{
          width: '92vw', maxWidth: 1100, padding: '40px 24px',
          background: '#0f1822',
          border: '1px solid rgba(102,192,244,0.18)',
          borderRadius: 6,
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 14, color: '#9bb5cc', marginBottom: 16 }}>
            {t().extras!.releaseNotesEmpty!()}
          </div>
          <DialogButton onClick={closeModal} style={{ minWidth: 160 }}>
            {t().common.close}
          </DialogButton>
        </Focusable>
      </ModalRoot>
    );
  }

  const current = releases[0];

  return (
    <ModalRoot onCancel={closeModal}>
      <Focusable
        onCancelButton={closeModal}
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: outerW,
          height: outerH,
          // Single bordered card -- ModalRoot already provides modal dimming,
          // but the inner card style gives the patch-notes overlay its
          // distinctive look
          background: '#0f1822',
          border: '1px solid rgba(102, 192, 244, 0.18)',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <Carousel
          fnItemRenderer={(id: number) => (
            <ReleaseColumn release={releases[id]} total={releases.length} idx={id} />
          )}
          fnGetId={(id) => id}
          nNumItems={releases.length}
          nHeight={itemH}
          nItemHeight={itemH}
          nItemMarginX={0}
          initialColumn={0}
          autoFocus
          fnGetColumnWidth={() => columnW}
          name={t().extras!.releaseNotes!() as string}
        />

        {/* Footer action buttons */}
        <Focusable style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 8,
          padding: '10px 22px',
          borderTop: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0,
        }}>
          {current.html_url && (
            <DialogButton
              onClick={() => { try { Navigation.NavigateToExternalWeb(current.html_url); } catch { /* ignore */ } }}
              style={{ minWidth: 180, fontSize: 12 }}
            >
              {t().extras!.releaseNotesOpenOnGitHub!()}
            </DialogButton>
          )}
          <DialogButton onClick={closeModal} style={{ minWidth: 140, fontSize: 12 }}>
            {t().common.close}
          </DialogButton>
        </Focusable>
      </Focusable>
    </ModalRoot>
  );
}

// Public API:
//   showReleaseNotesModal(initial?)
//     - If `initial` is provided, the modal opens with that release at
//       index 0 and loads history alongside it
//     - If `initial` is omitted, the modal loads the 10 most recent
//       releases from GitHub and shows the latest. Use this when Y is
//       pressed and no active update is queued
export function showReleaseNotesModal(initial?: {
  version: string;
  body: string;
  releaseUrl?: string;
  publishedAt?: string;
  isPrerelease?: boolean;
}): void {
  const seed: ReleaseRow | undefined = initial ? {
    version: initial.version,
    name: '',
    body: initial.body,
    published_at: initial.publishedAt ?? '',
    prerelease: !!initial.isPrerelease,
    html_url: initial.releaseUrl ?? '',
  } : undefined;
  const modal = showModal(
    <ReleaseNotesModal
      initial={seed}
      closeModal={() => modal?.Close()}
    />,
  );
}
