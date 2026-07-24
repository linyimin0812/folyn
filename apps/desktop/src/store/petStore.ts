import { create } from 'zustand';
import { registerPersistSlice, schedulePersist } from './settingsPersistence';
import {
  PET_SIZE_VERSION,
  PET_SIZE_DEFAULT,
  PET_SIZE_TO_PX,
  type PetSize,
  type Placement,
} from '@/components/pet/petPosition';
import type { BubbleTemplate } from '@/components/pet/bubbleTemplate';

// ponytail: PET_SIZE_VERSION / PET_SIZE_DEFAULT / PET_SIZE_TO_PX / PetSize are
// owned by petPosition.ts (the pure-math module). petStore imports them — this
// matches the legacy settingsStore which also imported them from petPosition.

export type PetIconSource = 'builtin' | 'custom';
/** Global notification routing (PRD pet-popover-corner). `'bubble'` routes to
 *  the in-app pet-bubble Popover card; `'corner'` routes to the new in-app
 *  corner toast (replaces the old `'system'` OS-native path — see Decision
 *  Log D1 in `.trellis/tasks/07-24-pet-popover-corner/prd.md`); `'off'` drops
 *  the notification entirely. */
export type NotificationForm = 'bubble' | 'corner' | 'off';
/** Screen corner for the corner toast stack (PRD pet-popover-corner). */
export type CornerPlacement = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';
/** Corner toast TTL. `number` = milliseconds; `'never'` = sticky until
 *  user-dismissed (PRD pet-popover-corner). */
export type CornerTtlMs = number | 'never';
/** Pet window opacity level (percent). Mirrors the Rust `set_pet_opacity`
 *  command + `PET_CTX_MENU_OPACITY_*` menu ids. `'100'` = fully opaque. */
export type PetOpacity = '25' | '50' | '75' | '100';

// Re-export so consumers can import pet-size constants from the store if they
// already hold a store import — but the canonical site remains petPosition.ts.
export { PET_SIZE_VERSION, PET_SIZE_DEFAULT, PET_SIZE_TO_PX, type PetSize, type Placement };

export const PERSIST_KEYS_PET = [
  'petPositionX',
  'petPositionY',
  'petPanelX',
  'petPanelY',
  'petPanelWidth',
  'petPanelHeight',
  'petPanelSizeVersion',
  'petPosVersion',
  'petIconSource',
  'petIconPath',
  'petIcons',
  'petSizeVersion',
  'petSize',
  'petOpacity',
  'petClickThrough',
  'notificationForm',
  'cornerPlacement',
  'cornerTtlMs',
  'bubbleUserTemplates',
  'bubbleActiveTemplateId',
  'bubbleAppWhitelist',
] as const;

export interface PetState {
  petModeEnabled: boolean;
  petPositionX: number;
  petPositionY: number;
  petPanelX: number;
  petPanelY: number;
  petPanelWidth: number;
  petPanelHeight: number;
  petPanelSizeVersion: number;
  petPosVersion: number;
  petIconSource: PetIconSource;
  petIconPath: string;
  /** All saved custom icon paths. `petIconPath` is the active selection
   *  from this list (or '' when source is `'builtin'`). */
  petIcons: string[];
  petSizeVersion: number;
  petSize: PetSize;
  petOpacity: PetOpacity;
  petClickThrough: boolean;
  notificationForm: NotificationForm;
  /** Screen corner the corner-toast stack attaches to (PRD
   *  pet-popover-corner). Default `'bottomRight'` (matches Windows). */
  cornerPlacement: CornerPlacement;
  /** Corner-toast TTL in ms, or `'never'` for sticky. Default 10000. */
  cornerTtlMs: CornerTtlMs;
  /** User-uploaded bubble templates. Built-ins (`BUILT_IN_TEMPLATES`) are
   *  injected from code at runtime, not persisted, so upgrades replace them
   *  without a migration. Runtime list = built-ins + these. */
  bubbleUserTemplates: BubbleTemplate[];
  /** Active template id. Resolves against built-ins + user templates. */
  bubbleActiveTemplateId: string;
  /** Whitelist of macOS app names approved for `launch.type = "app"`. */
  bubbleAppWhitelist: string[];

  setPetModeEnabled: (enabled: boolean) => void;
  setPetPosition: (x: number, y: number) => void;
  setPetPanelPosition: (x: number, y: number) => void;
  setPetPanelSize: (width: number, height: number) => void;
  setPetPanelSizeVersion: (version: number) => void;
  setPetIcon: (source: PetIconSource, path?: string) => void;
  addPetIcon: (path: string) => void;
  removePetIcon: (path: string) => void;
  resetPetIcons: () => void;
  setPetSize: (size: PetSize) => void;
  setPetOpacity: (opacity: PetOpacity) => void;
  setPetClickThrough: (enabled: boolean) => void;
  setNotificationForm: (form: NotificationForm) => void;
  setCornerPlacement: (placement: CornerPlacement) => void;
  setCornerTtlMs: (ttl: CornerTtlMs) => void;
  addBubbleUserTemplate: (template: BubbleTemplate) => void;
  removeBubbleUserTemplate: (id: string) => void;
  setBubbleActiveTemplateId: (id: string) => void;
  addBubbleAppToWhitelist: (app: string) => void;
  removeBubbleAppFromWhitelist: (app: string) => void;

  /** Load this store's slice from the persisted `settings:all` blob. */
  hydrate: (blob: Record<string, unknown>) => void;
}

function isPetIconSource(v: unknown): v is PetIconSource {
  return v === 'builtin' || v === 'custom';
}

function isPetSize(v: unknown): v is PetSize {
  return v === '50' || v === '75' || v === '100' || v === '125' || v === '150';
}

function isPetOpacity(v: unknown): v is PetOpacity {
  return v === '25' || v === '50' || v === '75' || v === '100';
}

function isNotificationForm(v: unknown): v is NotificationForm {
  return v === 'bubble' || v === 'corner' || v === 'off';
}

function isCornerPlacement(v: unknown): v is CornerPlacement {
  return v === 'topLeft' || v === 'topRight' || v === 'bottomLeft' || v === 'bottomRight';
}

function isCornerTtlMs(v: unknown): v is CornerTtlMs {
  return v === 'never' || (typeof v === 'number' && Number.isFinite(v) && v >= 0);
}

export const usePetStore = create<PetState>((set, get) => ({
  petModeEnabled: true,
  petPositionX: -1,
  petPositionY: -1,
  petPanelX: -1,
  petPanelY: -1,
  petPanelWidth: -1,
  petPanelHeight: -1,
  petPanelSizeVersion: 0,
  petPosVersion: 1,
  petIconSource: 'builtin',
  petIconPath: '',
  petIcons: [],
  petSizeVersion: 0,
  petSize: PET_SIZE_DEFAULT,
  petOpacity: '100',
  petClickThrough: false,
  notificationForm: 'bubble',
  cornerPlacement: 'bottomRight',
  cornerTtlMs: 10000,
  bubbleUserTemplates: [],
  bubbleActiveTemplateId: 'default',
  bubbleAppWhitelist: [],

  setPetModeEnabled: (enabled) => { set({ petModeEnabled: enabled }); schedulePersist(); },

  setPetPosition: (x, y) => { set({ petPositionX: x, petPositionY: y }); schedulePersist(); },

  setPetPanelPosition: (x, y) => { set({ petPanelX: x, petPanelY: y }); schedulePersist(); },

  setPetPanelSize: (width, height) => { set({ petPanelWidth: width, petPanelHeight: height }); schedulePersist(); },

  setPetPanelSizeVersion: (version) => { set({ petPanelSizeVersion: version }); schedulePersist(); },

  setPetIcon: (source, path) => {
    // When switching to `'builtin'`, clear the path (no file to track). When
    // switching to `'custom'`, the caller must pass the absolute path; if
    // omitted, keep the existing path (defensive — the upload flow always
    // passes the new path, but a stale `'custom'` flag without a path would
    // render nothing, so the PetMascot `<img>` onError falls back to builtin
    // at render time). The `petIcons` library is untouched — switching the
    // active source does not delete saved icons.
    if (source === 'builtin') {
      set({ petIconSource: 'builtin', petIconPath: '' });
    } else {
      set({
        petIconSource: 'custom',
        petIconPath: path !== undefined ? path : get().petIconPath,
      });
    }
    schedulePersist();
  },

  addPetIcon: (path) => {
    // Append to the library (deduped) and select the new icon in one step —
    // the upload flow expects "I just uploaded this, show it" semantics.
    const cur = get().petIcons;
    const next = cur.includes(path) ? cur : [...cur, path];
    set({ petIcons: next, petIconSource: 'custom', petIconPath: path });
    schedulePersist();
  },

  removePetIcon: (path) => {
    // Drop from the library. If the removed path was the active selection,
    // fall back to the first remaining icon (keeps source='custom'); if the
    // library is now empty, revert to builtin so PetMascot doesn't render a
    // broken <img> with an empty src.
    const cur = get().petIcons;
    const next = cur.filter((p) => p !== path);
    const { petIconPath } = get();
    if (petIconPath === path) {
      if (next.length > 0) {
        set({ petIcons: next, petIconPath: next[0] });
      } else {
        set({ petIcons: [], petIconSource: 'builtin', petIconPath: '' });
      }
    } else {
      set({ petIcons: next });
    }
    schedulePersist();
  },

  resetPetIcons: () => {
    // "恢复默认" — clear the library AND the active selection in one shot.
    // Distinct from `setPetIcon('builtin')` which only flips the active
    // source (the library survives a temporary switch to builtin).
    set({ petIcons: [], petIconSource: 'builtin', petIconPath: '' });
    schedulePersist();
  },

  setPetSize: (size) => { set({ petSize: size }); schedulePersist(); },

  setPetOpacity: (opacity) => { set({ petOpacity: opacity }); schedulePersist(); },

  setPetClickThrough: (enabled) => { set({ petClickThrough: enabled }); schedulePersist(); },

  setNotificationForm: (form) => { set({ notificationForm: form }); schedulePersist(); },

  setCornerPlacement: (placement) => { set({ cornerPlacement: placement }); schedulePersist(); },

  setCornerTtlMs: (ttl) => { set({ cornerTtlMs: ttl }); schedulePersist(); },

  addBubbleUserTemplate: (template) => {
    // ponytail: replace by id — importing the same id twice is an update, not
    // a duplicate. Reject ids that collide with built-in ids by silently
    // prefixing `user:` — caller (settings UI) should pre-check, but this is
    // the safety net so a malicious import can't shadow built-ins.
    // ponytail: 'default' is the only built-in (Cloudia). The collision
    // guard stops a user upload from shadowing it.
    const builtInIds = ['default'];
    const id = builtInIds.includes(template.id) ? `user:${template.id}` : template.id;
    const cur = get().bubbleUserTemplates;
    const next = [...cur.filter((t) => t.id !== id), { ...template, id }];
    set({ bubbleUserTemplates: next });
    schedulePersist();
  },

  removeBubbleUserTemplate: (id) => {
    const cur = get().bubbleUserTemplates;
    const next = cur.filter((t) => t.id !== id);
    set({ bubbleUserTemplates: next });
    // If the active template was removed, fall back to default.
    if (get().bubbleActiveTemplateId === id) {
      set({ bubbleActiveTemplateId: 'default' });
    }
    schedulePersist();
  },

  setBubbleActiveTemplateId: (id) => {
    set({ bubbleActiveTemplateId: id });
    schedulePersist();
  },

  addBubbleAppToWhitelist: (app) => {
    const cur = get().bubbleAppWhitelist;
    const trimmed = app.trim();
    if (!trimmed) return;
    if (cur.includes(trimmed)) return;
    set({ bubbleAppWhitelist: [...cur, trimmed] });
    schedulePersist();
  },

  removeBubbleAppFromWhitelist: (app) => {
    const cur = get().bubbleAppWhitelist;
    set({ bubbleAppWhitelist: cur.filter((a) => a !== app) });
    schedulePersist();
  },

  hydrate: (blob) => {
    // Mirror the legacy settingsStore hydrate: build a working copy of the
    // persisted fields, run the migrations in-place (so a later migration
    // sees an earlier one's override), then apply the result as a patch.
    // Only the PERSIST_KEYS_PET fields participate.
    const saved: Record<string, unknown> = {};
    for (const k of PERSIST_KEYS_PET) {
      if (blob[k] !== undefined) saved[k] = blob[k];
    }

    // Position-unit migration: pre-fix `petPosVersion !== 1` saved the pet
    // and panel positions in PHYSICAL pixels, which on Retina placed the pet
    // at screen-center on launch (logical work-area math applied to physical
    // values). Discard the stale physical-pixel positions so the default-
    // position branch re-runs and the next save stores logical points.
    if (saved.petPosVersion !== 1) {
      saved.petPositionX = -1;
      saved.petPositionY = -1;
      saved.petPanelX = -1;
      saved.petPanelY = -1;
      saved.petPosVersion = 1;
    }

    // Pet window-size migration: pre-shrink saved positions assumed the
    // 120×120 window. After shrinking to 96×96, a saved position computed
    // against the old size may now leave the smaller window oddly placed.
    // Discard the saved position when the persisted `petSizeVersion`
    // mismatches the current `PET_SIZE_VERSION` so the default-position
    // branch re-runs with the new size; persist the new version so subsequent
    // launches are stable. 0 = pre-versioning / unset, so any existing user
    // migrates on next launch.
    if (saved.petSizeVersion !== PET_SIZE_VERSION) {
      // Only discard pet window position (not panel — panel has its own
      // petPanelSizeVersion gate). Mirrors the legacy path.
      saved.petPositionX = -1;
      saved.petPositionY = -1;
      saved.petSizeVersion = PET_SIZE_VERSION;
    }

    // Coerce a missing/invalid `petIconSource` to `'builtin'` (defensive — a
    // corrupt persisted state without the field would otherwise render
    // `undefined` in the mascot switch).
    if (isPetIconSource(saved.petIconSource)) {
      // keep petIconPath as persisted (may be '' or a real path)
    } else {
      saved.petIconSource = 'builtin';
      saved.petIconPath = '';
    }

    // Coerce `petIcons` to a string[] (defensive — a persisted state from
    // before this feature would have `undefined`, and a corrupt blob could
    // have non-array/non-string entries). Drops non-string entries rather
    // than failing the whole hydrate.
    if (!Array.isArray(saved.petIcons)) {
      saved.petIcons = [];
    } else {
      saved.petIcons = saved.petIcons.filter(
        (p: unknown): p is string => typeof p === 'string',
      );
    }

    // Legacy single-icon migration: a persisted state from before the
    // multi-icon library had `petIconPath` set without a `petIcons` array.
    // Fold the active path into the library so it shows up in the thumbnail
    // strip instead of being an "invisible active custom icon".
    if (typeof saved.petIconPath === 'string' && saved.petIconPath &&
        Array.isArray(saved.petIcons) && !saved.petIcons.includes(saved.petIconPath)) {
      saved.petIcons = [...saved.petIcons, saved.petIconPath];
    }

    // Coerce a missing/invalid `petSize` to the default (defensive — a
    // persisted state from before this feature would otherwise have
    // `undefined`, crashing the `PET_SIZE_TO_PX` lookup).
    if (!isPetSize(saved.petSize)) saved.petSize = PET_SIZE_DEFAULT;

    // Coerce a missing/invalid `petOpacity` to the default (defensive — a
    // persisted state from before this feature would otherwise have
    // `undefined`, which the Rust `set_pet_opacity` validation would reject).
    if (!isPetOpacity(saved.petOpacity)) saved.petOpacity = '100';

    // Coerce a missing `petClickThrough` to the default `false` (defensive
    // — a persisted state from before this feature would otherwise have
    // `undefined`, which the Rust `set_pet_click_through` would treat as
    // falsy anyway, but the store type expects a strict boolean).
    if (typeof saved.petClickThrough !== 'boolean') saved.petClickThrough = false;

    // Coerce a missing/invalid `notificationForm` to the default `'bubble'`
    // (defensive — a persisted state from before this feature would otherwise
    // have `undefined`, which would break the dispatcher's switch). A
    // persisted `'system'` (removed in PRD pet-popover-corner — OS native
    // was replaced by the in-app corner toast) is migrated to `'corner'`,
    // preserving user intent for "non-bubble" notifications.
    if (saved.notificationForm === 'system') saved.notificationForm = 'corner';
    if (!isNotificationForm(saved.notificationForm)) saved.notificationForm = 'bubble';

    // Coerce `cornerPlacement` to a valid CornerPlacement (default
    // `'bottomRight'`).
    if (!isCornerPlacement(saved.cornerPlacement)) saved.cornerPlacement = 'bottomRight';

    // Coerce `cornerTtlMs` to a valid CornerTtlMs (default 10000).
    if (!isCornerTtlMs(saved.cornerTtlMs)) saved.cornerTtlMs = 10000;

    // Coerce `bubbleUserTemplates` to BubbleTemplate[] (defensive — a corrupt
    // blob could have non-object entries or missing fields). Drop entries
    // missing `id`/`html` rather than failing the whole hydrate.
    if (!Array.isArray(saved.bubbleUserTemplates)) {
      saved.bubbleUserTemplates = [];
    } else {
      saved.bubbleUserTemplates = saved.bubbleUserTemplates.filter(
        (t: unknown): t is BubbleTemplate => {
          if (typeof t !== 'object' || t === null) return false;
          const o = t as Record<string, unknown>;
          return typeof o.id === 'string' && typeof o.html === 'string' && typeof o.css === 'string';
        },
      );
    }

    // Coerce `bubbleActiveTemplateId` to a string (default `'default'`).
    if (typeof saved.bubbleActiveTemplateId !== 'string') {
      saved.bubbleActiveTemplateId = 'default';
    }

    // Coerce `bubbleAppWhitelist` to a string[].
    if (!Array.isArray(saved.bubbleAppWhitelist)) {
      saved.bubbleAppWhitelist = [];
    } else {
      saved.bubbleAppWhitelist = saved.bubbleAppWhitelist.filter(
        (a: unknown): a is string => typeof a === 'string',
      );
    }

    // Apply the migrated working copy as a patch. The cast is safe — every
    // key in `saved` came from PERSIST_KEYS_PET (typed fields).
    set(saved as Partial<PetState>);
  },
}));

registerPersistSlice({
  keys: PERSIST_KEYS_PET,
  getState: () => usePetStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => usePetStore.getState().hydrate(blob),
});
