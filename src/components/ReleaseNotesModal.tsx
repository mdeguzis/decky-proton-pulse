// Release notes browser. Literal copy of Decky Loader's PatchNotesModal
// pattern (frontend/src/components/settings/pages/general/Updater.tsx):
//
//   <Focusable onCancelButton={closeModal}>
//     <Carousel
//       fnItemRenderer={(id) => (
//         <Focusable style={... translucent dark bg, margin, padding}>
//           <h1>{name}</h1>
//           <body markdown />
//         </Focusable>
//       )}
//       ... column dims from findSP()
//     />
//   </Focusable>
//
// No ModalRoot, no outer card frame -- the Steam BPM backdrop is the modal
// chrome, and each carousel column is the "card" with its own background.
// Same gamepad mechanics: shoulder buttons page L/R via Carousel, B closes
// via the root Focusable's onCancelButton.

import { useEffect, useState } from 'react';
import {
  Carousel, Focusable, DialogButton, Navigation, showModal, findSP,
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
  developer?: boolean;
  html_url: string;
}

// Channel arg drives whether per-build dev tags are merged into the list.
// 'developer' -> include dev tag history; anything else -> stable + prerelease
// releases only (rolling 'developer' release is filtered out either way)
const listReleases = callable<
  [number, boolean, string],
  { success: boolean; releases: ReleaseRow[]; error?: string }
>('list_releases');

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

// Render the GitHub publish timestamp as a short weekday + date + full
// UTC time string. We keep the UTC suffix so users on the Deck dont have
// to guess what timezone a release was cut in. Example output:
//   "Fri, May 30 . 14:35 UTC"
function formatPublishedDate(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC',
    });
    const time = d.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC',
    });
    return `${date} . ${time} UTC`;
  } catch { return ''; }
}

// One carousel column. Translucent dark card with margin + padding (Decky's
// values: rgba(37,40,46,0.5) bg, 30px margin, 0/15px padding).
function ReleaseColumn({
  release, total, idx, closeModal,
}: { release: ReleaseRow; total: number; idx: number; closeModal?: () => void }) {
  const { onRowFocus, onRowBlur, focusBorder } = useFocusableScroll();
  const blocks = parseBody(release.body || '');
  const publishedLabel = formatPublishedDate(release.published_at);
  // Three channel pills: DEV (rolling), PRE-RELEASE, RELEASE. The dev
  // one uses a brighter cyan so it stands out from prerelease orange
  const channelLabel = release.developer
    ? t().extras!.updateChannelDeveloper!()
    : release.prerelease
      ? t().extras!.updateChannelPreRelease!()
      : t().extras!.updateChannelRelease!();
  const channelColor = release.developer
    ? '#5ec8f4'
    : release.prerelease
      ? '#f6b347'
      : '#9bb5cc';

  return (
    <Focusable
      style={{
        marginTop: '40px',
        height: 'calc(100% - 40px)',
        overflowY: 'scroll',
        display: 'flex',
        flexDirection: 'column',
        margin: '30px',
        padding: '20px 24px',
        backgroundColor: 'rgba(37, 40, 46, 0.55)',
        borderRadius: 6,
      }}
    >
      {/* metadata strip */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 10,
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
          color: channelColor,
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
      <h1 style={{
        margin: '0 0 14px',
        fontSize: 28,
        fontWeight: 800,
        color: '#ffffff',
        lineHeight: 1.15,
      }}>
        {release.name || formatVersion(release.version)}
      </h1>

      {/* body blocks */}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {blocks.length === 0 ? (
          <div style={{ padding: '20px 0', color: '#9bb5cc', fontSize: 14 }}>
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
                  padding: '14px 0 4px',
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
                  padding: '6px 8px 6px 22px',
                  fontSize: 14, color: '#dbe7ef', lineHeight: 1.55,
                  position: 'relative',
                  borderRight: focusBorder(id),
                }}
              >
                <span style={{
                  position: 'absolute', left: 6, top: 14,
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
                padding: '6px 0',
                fontSize: 14, color: '#c8dcea', lineHeight: 1.55,
                borderRight: focusBorder(id),
              }}
            >{b.text}</PpDialogButton>
          );
        })}
      </div>

      {/* in-column footer actions (Open on GitHub / Close) so users dont have
          to scroll back up after reading. Each focusable, A button activates */}
      <Focusable style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-end',
        gap: 8,
        marginTop: 24,
        paddingTop: 16,
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}>
        {release.html_url && (
          <DialogButton
            onClick={() => { try { Navigation.NavigateToExternalWeb(release.html_url); } catch { /* ignore */ } }}
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
  );
}

interface Props {
  initial?: ReleaseRow;
  // Current user update channel ('release' | 'pre-release' | 'developer').
  // Drives whether dev-tag history is included by the backend
  channel?: string;
  closeModal?: () => void;
}

function ReleaseNotesModal({ initial, channel = 'release', closeModal }: Props) {
  const [releases, setReleases] = useState<ReleaseRow[] | null>(initial ? [initial] : null);
  const SP = findSP();

  useEffect(() => {
    void (async () => {
      try {
        const res = await listReleases(10, true, channel);
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
        });
      } catch (e) {
        if (!initial) setReleases([]);
        void logFrontendEvent('WARNING', 'ReleaseNotesModal: history load failed', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  }, [initial, channel]);

  // Column dimensions copy Decky Loader's PatchNotesModal exactly:
  //   nHeight = nItemHeight = SP.innerHeight - 40
  //   fnGetColumnWidth = () => SP.innerWidth - SP.innerWidth * (10 / 100)
  // That gives ~90% wide columns and full minus chrome height
  const itemH = SP.innerHeight - 40;
  const columnW = SP.innerWidth - SP.innerWidth * 0.1;

  if (!releases || releases.length === 0) {
    return (
      <Focusable onCancelButton={closeModal}>
        <div style={{
          margin: 30,
          padding: 40,
          backgroundColor: 'rgba(37, 40, 46, 0.55)',
          borderRadius: 6,
          textAlign: 'center',
          color: '#9bb5cc',
        }}>
          {releases === null ? '...' : t().extras!.releaseNotesEmpty!()}
        </div>
      </Focusable>
    );
  }

  return (
    <Focusable onCancelButton={closeModal}>
      {/* `key` forces React (and Steam's Carousel) to start fresh each time
          the modal opens AND each time the release list grows from [initial]
          to the full history. Without it, Carousel's saved column index
          (keyed by the `name` prop in Steam's focus-restoration store)
          would carry over from a previous open -- so closing at 4/9 and
          reopening would land back at 4/9 instead of 1/9. The length is
          part of the key so the carousel also resets when the array grows
          from 1 (initial only) to N (after list_releases returns) */}
      <Carousel
        key={`releases-${releases.length}`}
        fnItemRenderer={(id: number) => (
          <ReleaseColumn
            release={releases[id]}
            total={releases.length}
            idx={id}
            closeModal={closeModal}
          />
        )}
        fnGetId={(id) => id}
        nNumItems={releases.length}
        nHeight={itemH}
        nItemHeight={itemH}
        nItemMarginX={0}
        initialColumn={0}
        nIndexLeftmost={0}
        autoFocus
        fnGetColumnWidth={() => columnW}
        name={t().extras!.releaseNotes!() as string}
      />
    </Focusable>
  );
}

export function showReleaseNotesModal(opts?: {
  initial?: {
    version: string;
    body: string;
    releaseUrl?: string;
    publishedAt?: string;
    isPrerelease?: boolean;
    isDeveloper?: boolean;
  };
  // Current user channel ('release' | 'pre-release' | 'developer'). Drives
  // whether the backend includes dev-tag history in the carousel
  channel?: string;
}): void {
  const initial = opts?.initial;
  const seed: ReleaseRow | undefined = initial ? {
    version: initial.version,
    name: '',
    body: initial.body,
    published_at: initial.publishedAt ?? '',
    prerelease: !!initial.isPrerelease,
    developer: !!initial.isDeveloper,
    html_url: initial.releaseUrl ?? '',
  } : undefined;
  const modal = showModal(
    <ReleaseNotesModal
      initial={seed}
      channel={opts?.channel ?? 'release'}
      closeModal={() => modal?.Close()}
    />,
  );
}
