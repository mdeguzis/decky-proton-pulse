// src/components/CleanupVersionList.tsx
//
// Body of the Remove unused confirm dialog (#138): a short intro, then the
// versions as a bulleted list. A list that fits is plain text, so the D-pad
// goes straight to Remove / Cancel. A longer one becomes a capped, scrolling
// list of focusable rows: Steam's gamepad layer can only scroll something
// that has focusable children, so a bare overflow box would be dead to the
// D-pad (see the decky-proton-pulse-patterns skill).

import { DialogButton, Focusable } from '@decky/ui';
import { useFocusableScroll } from '../lib/useFocusableScroll';

const PpDialogButton = DialogButton as React.ComponentType<
  React.ComponentProps<typeof DialogButton> & {
    onFocus?: (e: React.FocusEvent<HTMLElement>) => void;
    onBlur?: () => void;
  }
>;

// Rows shown before the list scrolls.
export const CLEANUP_LIST_MAX_VISIBLE = 6;
const ROW_HEIGHT = 28;

const BULLET_ROW: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'baseline',
  fontSize: 13,
  lineHeight: '20px',
  color: '#dfe9f3',
  wordBreak: 'break-all',
};

export function CleanupVersionList({ intro, lines }: { intro: string; lines: string[] }) {
  const { onRowFocus, onRowBlur, focusBorder } = useFocusableScroll({ block: 'nearest' });
  const scrolls = lines.length > CLEANUP_LIST_MAX_VISIBLE;

  return (
    <div>
      <div style={{ marginBottom: 10 }}>{intro}</div>
      {scrolls ? (
        <Focusable
          style={{
            display: 'flex',
            flexDirection: 'column',
            maxHeight: CLEANUP_LIST_MAX_VISIBLE * ROW_HEIGHT,
            overflowY: 'auto',
            paddingRight: 6,
          }}
        >
          {lines.map((line, i) => (
            <PpDialogButton
              key={`${i}-${line}`}
              onClick={() => {}}
              onFocus={onRowFocus(`cleanup-${i}`)}
              onBlur={onRowBlur}
              style={{
                ...BULLET_ROW,
                minHeight: ROW_HEIGHT,
                padding: '4px 8px',
                background: 'transparent',
                border: 'none',
                boxShadow: 'none',
                textAlign: 'left',
                borderRight: focusBorder(`cleanup-${i}`),
              }}
            >
              <span aria-hidden="true">•</span>
              <span>{line}</span>
            </PpDialogButton>
          ))}
        </Focusable>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {lines.map((line, i) => (
            <div key={`${i}-${line}`} style={{ ...BULLET_ROW, paddingLeft: 4 }}>
              <span aria-hidden="true">•</span>
              <span>{line}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
