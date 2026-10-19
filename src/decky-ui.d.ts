// Steam's DialogButton is a focusable Panel and honours autoFocus at runtime,
// but @decky/ui's DialogButtonProps does not declare it. Used by the Cache
// Manager so the Stats button takes focus when the modal opens.
import '@decky/ui/dist/components/Dialog';

declare module '@decky/ui/dist/components/Dialog' {
  interface DialogButtonProps {
    autoFocus?: boolean;
  }
}
