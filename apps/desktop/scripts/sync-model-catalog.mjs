// sync-model-catalog.mjs — pull models.dev + OpenRouter, write the runtime
// catalog JSON shipped with the app.
//
// Run manually before releases:
//   node apps/desktop/scripts/sync-model-catalog.mjs
//
// ponytail: no zod. Catalog shape is simple enough for manual type guards;
// adding a dep for ~30 lines of validation isn't worth it. If models.dev
// shifts schema, the loader's guard fails loudly at app boot.

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = resolve(__dirname, '../src/services/modelRegistry/data/models-catalog.json');

// models.dev provider id → our catalog provider id. null = skip.
const PROVIDER_ALIAS = {
  anthropic: 'anthropic',
  openai: 'openai',
  azure: 'azure-openai',
  cohere: 'cohere',
  deepseek: 'deepseek',
  google: 'gemini',
  gemini: 'gemini',
  huggingface: 'huggingface',
  hf: 'huggingface',
  groq: 'groq',
  hyperbolic: 'hyperbolic',
  mira: 'mira',
  moonshot: 'moonshot',
  ollama: 'ollama',
  openrouter: 'openrouter',
  perplexity: 'perplexity',
  together: 'together',
  togetherai: 'together',
  xai: 'xai',
  x_ai: 'xai',
  galadriel: 'galadriel',
  eternalai: 'eternalai',
  'eternal-ai': 'eternalai',
};

function mapCapability(m) {
  const caps = [];
  if (m.attachment) caps.push('vision');
  if (m.reasoning) caps.push('reasoning');
  if (m.tool_call) caps.push('function-call');
  if (m.structured_output) caps.push('structured-output');
  return caps;
}

function transformModel(providerId, m) {
  return {
    id: m.id,
    providerId,
    capabilities: mapCapability(m),
    inputModalities: m.modalities?.input ?? ['text'],
    ...(m.cost && (m.cost.input || m.cost.output)
      ? { pricing: { inputPerMtok: m.cost.input, outputPerMtok: m.cost.output } }
      : {}),
  };
}

async function fetchJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

async function main() {
  console.log('Fetching models.dev/api.json …');
  const dev = await fetchJson('https://models.dev/api.json');
  if (!dev || typeof dev !== 'object') throw new Error('models.dev root not an object');

  console.log('Fetching OpenRouter /v1/models …');
  let orCount = 0;
  let orModels;
  try {
    orModels = await fetchJson('https://openrouter.ai/api/v1/models');
  } catch (e) {
    console.warn(`OpenRouter fetch failed (skipping): ${e.message}`);
    orModels = { data: [] };
  }

  const catalog = {};
  let kept = 0;
  let skipped = 0;

  for (const [devProviderId, providerObj] of Object.entries(dev)) {
    const providerId = PROVIDER_ALIAS[devProviderId];
    if (!providerId) { skipped++; continue; }
    if (!providerObj || typeof providerObj !== 'object') continue;
    const models = providerObj.models;
    if (!models || typeof models !== 'object') continue;

    for (const [, m] of Object.entries(models)) {
      if (!m || typeof m !== 'object' || typeof m.id !== 'string') continue;
      const entry = transformModel(providerId, m);
      catalog[`${providerId}:${m.id}`] = entry;
      kept++;
    }
  }

  // OpenRouter supplements: add pricing for entries models.dev missed.
  // OpenRouter's `data[].id` is `${vendor}/${model}` (e.g. `anthropic/claude-3.5-sonnet`);
  // we look up by suffix match against our catalog.
  for (const row of orModels?.data ?? []) {
    if (!row || typeof row.id !== 'string') continue;
    const slashIdx = row.id.indexOf('/');
    const modelName = slashIdx >= 0 ? row.id.slice(slashIdx + 1) : row.id;
    // Find catalog entries ending with this model name.
    for (const [key, entry] of Object.entries(catalog)) {
      if (entry.id === modelName && !entry.pricing && row.pricing) {
        const prompt = row.pricing.prompt;
        const completion = row.pricing.completion;
        if (prompt || completion) {
          // OpenRouter prices are per token; convert to per million.
          catalog[key].pricing = {
            inputPerMtok: prompt ? Number(prompt) * 1e6 : undefined,
            outputPerMtok: completion ? Number(completion) * 1e6 : undefined,
          };
          orCount++;
        }
      }
    }
  }

  const out = {
    models: catalog,
    generatedAt: new Date().toISOString(),
  };
  await writeFile(OUT_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`Wrote ${kept} models (${orCount} pricing-supplemented, ${skipped} providers skipped) → ${OUT_PATH}`);
}

main().catch((e) => {
  console.error('sync failed:', e);
  process.exit(1);
});
