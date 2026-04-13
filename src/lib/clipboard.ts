import { callable } from '@decky/api';

const copyToClipboardBackend = callable<[text: string], boolean>('copy_to_clipboard');

export async function copyToClipboard(text: string): Promise<boolean> {
  return copyToClipboardBackend(text);
}
