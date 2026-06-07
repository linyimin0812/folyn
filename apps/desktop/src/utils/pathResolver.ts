export async function resolveBasePath(basePath: string): Promise<string> {
  let resolved = basePath;
  if (resolved.startsWith('~')) {
    const { homeDir } = await import('@tauri-apps/api/path');
    const home = (await homeDir()).replace(/\/+$/, '');
    resolved = home + resolved.slice(1);
  }
  return resolved.replace(/\/+$/, '');
}
