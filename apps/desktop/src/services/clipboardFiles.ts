// Frontend shim for the `read_clipboard_files` Tauri command. Returns the file
// paths currently on the OS clipboard (Finder Cmd+C / Explorer Ctrl+C), or an
// empty array when the clipboard holds text/image but no file refs. The caller
// (App.tsx paste listener) treats empty as "fall through to normal text paste".
//
// See task 08-30-paste-external-files-with-folder-picker.

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '@/utils/platform';

export async function readClipboardFiles(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<string[]>('read_clipboard_files');
  } catch (err) {
    console.error('[clipboardFiles] read_clipboard_files failed', err);
    return [];
  }
}
