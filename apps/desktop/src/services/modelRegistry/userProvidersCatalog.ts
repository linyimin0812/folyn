/**
 * User-data-dir catalog for per-provider models.json.
 *
 * Files at `~/.quill/providers/{providerId}/models.json` are the runtime-
 * writable mirror of the bundled baseline at
 * `apps/desktop/src/assets/providers/{p}/models.json`. The bundled files
 * ship with the app; the user-dir files are written by the "refresh from
 * models.dev" button and survive across launches.
 *
 * On-disk shape is the RAW provider slice from models.dev/api.json —
 * no transform. `{ id, env, npm, name, doc, models: {...} }`.
 *
 * ponytail: these files are NOT yet wired into `loader.ts`'s catalog Map.
 * The existing catalog reads `data/models-catalog.json` (older, lighter
 * shape). Wiring the user-dir files into the loader requires reconciling
 * the capability taxonomies — separate task.
 */

import { homeDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { fetchModelsDevCatalog, type ModelsDevModel, type ModelsDevProvider, type ModelsDevResponse } from './fetchModelsDev';
import { fetchOwnerMap, ownerLookupKey } from './fetchOwnerMap';

export const USER_PROVIDERS = [
  'anthropic', 'azure', 'cohere', 'deepseek', 'google', 'groq',
  'huggingface', 'moonshotai', 'openai', 'openrouter', 'perplexity',
  'togetherai', 'xai',
] as const;
export type UserProviderId = (typeof USER_PROVIDERS)[number];

/** On-disk shape: the `models` map directly — `{ modelId: ModelsDevModel & { owner } }`. */
export type ProviderModelsFile = Record<string, ModelsDevModel>;

let cachedDir: string | null = null;

export async function getUserProvidersDir(): Promise<string> {
  if (cachedDir) return cachedDir;
  const home = await homeDir();
  cachedDir = await join(home, '.quill', 'providers');
  return cachedDir;
}

export async function readUserProviderModels(providerId: string): Promise<ProviderModelsFile | null> {
  try {
    const dir = await getUserProvidersDir();
    const filePath = await join(dir, providerId, 'models.json');
    if (!(await exists(filePath))) return null;
    const raw = await readTextFile(filePath);
    return JSON.parse(raw) as ProviderModelsFile;
  } catch {
    return null;
  }
}

export async function writeUserProviderModels(
  providerId: string,
  file: ProviderModelsFile,
): Promise<void> {
  const dir = await getUserProvidersDir();
  const providerDir = await join(dir, providerId);
  if (!(await exists(providerDir))) {
    await mkdir(providerDir, { recursive: true });
  }
  const filePath = await join(providerDir, 'models.json');
  await writeTextFile(filePath, JSON.stringify(file, null, 2) + '\n');
}

export interface RefetchResult {
  providers: string[];
  totalModels: number;
}

export async function refetchAllFromModelsDev(): Promise<RefetchResult> {
  const catalog = await fetchModelsDevCatalog() as ModelsDevResponse;
  // ponytail: fetchOwnerMap never throws — on failure returns {} so each
  // model falls back to `owner = current provider id` below.
  const ownerMap = await fetchOwnerMap();
  const providers: string[] = [];
  let totalModels = 0;
  for (const p of USER_PROVIDERS) {
    const provider = catalog[p];
    if (!provider) continue;
    const file = buildModelsFile(provider, p, ownerMap);
    await writeUserProviderModels(p, file);
    providers.push(p);
    totalModels += Object.keys(file).length;
  }
  return { providers, totalModels };
}

/** Return just the `models` map with `owner` injected per model. */
function buildModelsFile(
  provider: ModelsDevProvider,
  defaultOwner: string,
  ownerMap: Record<string, string>,
): ProviderModelsFile {
  const out: ProviderModelsFile = {};
  for (const [id, m] of Object.entries(provider.models ?? {})) {
    const key = ownerLookupKey(id);
    out[id] = { ...m, owner: ownerMap[key] ?? defaultOwner };
  }
  return out;
}

export type { ModelsDevProvider, ModelsDevResponse };
