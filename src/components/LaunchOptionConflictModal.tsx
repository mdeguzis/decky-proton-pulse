import { ModalRoot, DialogButton, Focusable, showModal } from '@decky/ui';
import { t } from '../lib/i18n';

export type LaunchOptionConflictChoice = 'append' | 'replace' | 'cancel';

function LaunchOptionConflictModal({
  appName,
  currentLaunchOptions,
  incomingLaunchOptions,
  onResolve,
}: {
  appName: string;
  currentLaunchOptions: string;
  incomingLaunchOptions: string;
  closeModal?: () => void;
  onResolve: (choice: LaunchOptionConflictChoice) => void;
}) {
  return (
    <ModalRoot onCancel={() => onResolve('cancel')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 560, maxWidth: 720, padding: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#e8f4ff', marginBottom: 8 }}>
            {t().configure.launchOptionConflictTitle}
          </div>
          <div style={{ fontSize: 12, color: '#9eb7cc', lineHeight: 1.5 }}>
            {t().configure.launchOptionConflictDescription(appName)}
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#9eb7cc', lineHeight: 1.45 }}>
          {t().configure.launchOptionConflictWarning}
        </div>
        <div style={{ display: 'grid', gap: 10 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#7f9bb2', textTransform: 'uppercase', marginBottom: 4 }}>
              {t().configure.launchOptionConflictCurrent}
            </div>
            <div style={{ fontSize: 11, color: '#e8f4ff', background: '#162535', borderRadius: 8, padding: '10px 12px', wordBreak: 'break-word' }}>
              {currentLaunchOptions}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#7f9bb2', textTransform: 'uppercase', marginBottom: 4 }}>
              {t().configure.launchOptionConflictIncoming}
            </div>
            <div style={{ fontSize: 11, color: '#e8f4ff', background: '#162535', borderRadius: 8, padding: '10px 12px', wordBreak: 'break-word' }}>
              {incomingLaunchOptions}
            </div>
          </div>
        </div>
        <Focusable
          style={{ display: 'flex', gap: 10, justifyContent: 'stretch', marginTop: 4 }}
        >
          <DialogButton onClick={() => onResolve('append')} style={{ flex: 1, minWidth: 0 }}>
            {t().configure.launchOptionConflictAppend}
          </DialogButton>
          <DialogButton onClick={() => onResolve('replace')} style={{ flex: 1, minWidth: 0 }}>
            {t().configure.launchOptionConflictReplace}
          </DialogButton>
          <DialogButton onClick={() => onResolve('cancel')} style={{ flex: 1, minWidth: 0 }}>
            {t().common.cancel}
          </DialogButton>
        </Focusable>
      </div>
    </ModalRoot>
  );
}

export function showLaunchOptionConflictPreview(
  appName: string,
  currentLaunchOptions: string,
  incomingLaunchOptions: string,
): void {
  const modal = showModal(
    <LaunchOptionConflictModal
      appName={appName}
      currentLaunchOptions={currentLaunchOptions}
      incomingLaunchOptions={incomingLaunchOptions}
      onResolve={() => {
        modal?.Close();
      }}
    />,
  );
}

// Applying a config always REPLACES the current launch options with the
// incoming set. The old Append / Replace / Cancel prompt was noisy and
// almost every user picked Replace anyway. The append path stays around
// (appendLaunchOptions helper, LaunchOptionConflictModal component) for
// screenshot-mode previews and possible future explicit callers, but the
// primary resolver is now unconditional.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function resolveLaunchOptionsWithPrompt(
  _appName: string,
  _currentLaunchOptions: string,
  incomingLaunchOptions: string,
): Promise<string | null> {
  return incomingLaunchOptions;
}
