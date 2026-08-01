# Reorder AI input modes + reusable model pair dropdown

## Requirements

1. **Reusable model-pair dropdown** (`PairSelector` restyle, used by AiPanel / PetChat / settings pages):
   - Row layout: `[provider icon] **providerId** | modelId …… [capability icons]` — provider name **bold**, capability icons right-aligned.
   - Replace the native `<select>` with a custom dropdown (matches AdapterSelector / mode-menu patterns).
   - New props: `trigger: 'full' | 'icon'` (icon = compact square button for input toolbars), `dropDirection: 'up' | 'down'`.
   - Capability icons come from the model registry (`findModelInCatalog` + `modelRegistryStore.modelsByProvider` fallback).
   - Shared icon primitives extracted to `components/icons/` (`ProviderIcon`, `CAPABILITY_PILL` + compact `CapabilityIcons`) so settings helpers reuse them too.

2. **AI chat input mode reorder + linkage**:
   - Built-in mode order: Chat → Agent → Ask (registration order in `inputModes.ts`).
   - When mode is Chat (rig backend): show a model-select icon button next to the mode selector; clicking opens the pair dropdown (upward). This **replaces** the PairSelector bar at the top of AiPanel.
   - When mode is Agent/Ask (CLI adapter): show the Agent CLI icon (`AdapterSelector`) instead.

## Out of scope

- PetChat / settings pages keep their PairSelector placement; they inherit the new style automatically.
- Default `inputMode` stays `agent` (persisted per user anyway).

## Files

- `apps/desktop/src/components/icons/ProviderIcon.tsx` (new)
- `apps/desktop/src/components/icons/capabilityIcons.tsx` (new)
- `apps/desktop/src/components/settings/model-services/helpers.tsx` (reuse extracted icons)
- `apps/desktop/src/components/ai/PairSelector.tsx` (rewrite as custom dropdown)
- `apps/desktop/src/components/ai/inputModes.ts` (reorder)
- `apps/desktop/src/components/ai/ChatInput.tsx` (mode-linked selector)
- `apps/desktop/src/components/ai/AiPanel.tsx` (drop top pair bar)
- Tests: `inputModes.test.ts`, `PairSelector.test.tsx`, `ChatInput.test.tsx`
