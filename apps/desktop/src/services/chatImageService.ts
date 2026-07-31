import { useVaultStore } from '@/store/vaultStore';
import { resolveBasePath } from '@/utils/pathResolver';
import { generateShortId } from '@/utils/idGenerator';
import { isTauri } from '@/utils/platform';

/** Directory under the vault root where chat-generated images are saved. */
export const CHAT_IMAGES_DIR = '__attachments__';

/** Decode a `data:image/<mt>;base64,<...>` URL into its raw bytes. */
function decodeDataUrl(data: string): { bytes: Uint8Array; ext: string } {
  const comma = data.indexOf(',');
  const meta = data.slice(0, comma);
  // meta = "data:image/png;base64"
  const slash = meta.indexOf('/');
  const semi = meta.indexOf(';');
  const mt = meta.slice(slash + 1, semi === -1 ? meta.length : semi);
  const b64 = data.slice(comma + 1);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  // ponytail: ext mirrors media type — png / jpeg / webp / svg+xml. For
  // svg+xml we keep the `+xml` (filesystems accept `+` in filenames); if
  // the user wants a clean `.svg` extension, narrow here.
  return { bytes, ext: mt };
}

/** Save an inline assistant image (data URL) into the active vault under
 *  `<vault>/__attachments__/img-<YYYYMMDD-HHMMSS>-<short>.<ext>`. Creates
 *  the directory if missing. Returns the absolute path on success.
 *  Throws if no active vault, in non-Tauri contexts, or on write failure. */
export async function saveImageToVault(dataUrl: string): Promise<string> {
  if (!isTauri()) throw new Error('saveImageToVault requires Tauri');
  const vault = useVaultStore.getState().currentVault;
  if (!vault) throw new Error('No active vault');
  const basePath = await resolveBasePath(vault.basePath);
  const { bytes, ext } = decodeDataUrl(dataUrl);
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .slice(0, 15); // YYYYMMDD-HHMMSS
  const name = `img-${ts}-${generateShortId()}.${ext}`;
  const dir = `${basePath}/${CHAT_IMAGES_DIR}`;
  const fullPath = `${dir}/${name}`;
  const { mkdir, writeFile } = await import('@tauri-apps/plugin-fs');
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    // directory may already exist
  }
  await writeFile(fullPath, bytes);
  return fullPath;
}
