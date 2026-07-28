// Writes per-provider models.json — the `models` map only, with `owner`
// injected into each entry. Provider-level fields (id, env, npm, name, doc)
// are dropped; the file is just `{ modelId: { ...model, owner } }`.
//
// Flow:
//   1. Read cached api.json response from disk (or fetch fresh).
//   2. Build owner map from OpenRouter /models + /embeddings/models.
//      (failures are non-fatal — each model defaults to current provider)
//   3. For each provider, write the `models` map (with `owner` per entry)
//      to apps/desktop/src/assets/providers/{p}/models.json.
//
// Run: node scripts/sync-models-dev.ts  (Node 23.6+ strips TS types by default)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelsDevModel, ModelsDevProvider, ModelsDevResponse } from '../apps/desktop/src/services/modelRegistry/fetchModelsDev.ts';
import { fetchOwnerMap, ownerLookupKey } from '../apps/desktop/src/services/modelRegistry/fetchOwnerMap.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.env.SRC ?? '/tmp/models-dev.json';
const OUT_DIR = path.resolve(__dirname, '..', 'apps/desktop/src/assets/providers');

const PROVIDERS = [
  'anthropic', 'azure', 'cohere', 'deepseek', 'google', 'groq',
  'huggingface', 'moonshotai', 'openai', 'openrouter', 'perplexity',
  'togetherai', 'xai',
] as const;

function buildModelsFile(
  provider: ModelsDevProvider,
  defaultOwner: string,
  ownerMap: Record<string, string>,
): Record<string, ModelsDevModel> {
  const out: Record<string, ModelsDevModel> = {};
  for (const [id, m] of Object.entries(provider.models ?? {})) {
    const key = ownerLookupKey(id);
    out[id] = { ...m, owner: ownerMap[key] ?? defaultOwner };
  }
  return out;
}

const raw = JSON.parse(fs.readFileSync(SRC, 'utf8')) as ModelsDevResponse;
const ownerMap = await fetchOwnerMap();
console.log(`[owner-map] ${Object.keys(ownerMap).length} entries`);

let totalFiles = 0;
for (const p of PROVIDERS) {
  const provider = raw[p];
  if (!provider) {
    console.warn(`[skip] ${p}: not in api.json`);
    continue;
  }
  const file = buildModelsFile(provider, p, ownerMap);
  const dir = path.join(OUT_DIR, p);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, 'models.json');
  fs.writeFileSync(dest, JSON.stringify(file, null, 2) + '\n');
  console.log(`[ok] ${p}: ${Object.keys(file).length} models → ${path.relative(__dirname, dest)}`);
  totalFiles++;
}
console.log(`Done. ${totalFiles} files written.`);
