/**
 * Activity collector declaration registry (design §2/§3).
 *
 * Merges `collectors` / `activityDisplay` / `entityTypes` declarations from
 * every ACTIVE trusted extension (the trusted adapter registers on activate
 * and unregisters on deactivate, so "enabled" falls out of activation —
 * mirrors featurePanelStore's reactive-registry pattern; the set changes at
 * runtime, so a plain singleton would never re-render the UI).
 *
 * Merge rules (design §3.4): the entity-type table is builtin 5 +
 * first-registered custom types; a later registration hitting an occupied id
 * is SKIPPED and recorded in `conflicts` so the extension store can show the
 * "类型注册冲突" badge naming the winner. Same first-wins rule for
 * activityDisplay entries and collector ids.
 */

import { create } from 'zustand';
import type {
  ActivityDisplayContribution,
  CollectorContribution,
  CollectorExtension,
  EntityTypeContribution,
} from '@folyn/extension-host';

/** The builtin entity types the core natively knows (design §7.2 fixed five). */
export const BUILTIN_ENTITY_TYPES: RegisteredEntityType[] = [
  { id: 'person', label: '人物', color: 'blue', icon: 'user', owner: 'builtin' },
  { id: 'meeting', label: '会议', color: 'purple', icon: 'calendar', owner: 'builtin' },
  { id: 'repository', label: '仓库', color: 'teal', icon: 'git-branch', owner: 'builtin' },
  { id: 'document', label: '文档', color: 'green', icon: 'file-text', owner: 'builtin' },
  { id: 'task', label: '任务', color: 'amber', icon: 'check-square', owner: 'builtin' },
];

/** A resolved entity type: builtin 5 or a collector-registered custom type. */
export interface RegisteredEntityType extends EntityTypeContribution {
  /** 'builtin' or the owning extension id — who wins future collisions. */
  owner: string;
}

/** One entity-type id collision, surfaced in the extension store UI. */
export interface EntityTypeConflict {
  /** The colliding type id, e.g. `customer`. */
  typeId: string;
  /** Extension whose registration was skipped. */
  extensionId: string;
  /** Who owns the winning registration: 'builtin' or an extension id. */
  winner: string;
}

/** Display index entry: the declaration + which collector declared it. */
export interface DisplayIndexEntry extends ActivityDisplayContribution {
  collectorId: string;
}

/** A collector merged from manifest declaration + module impl. */
export interface CollectorRegistration {
  collectorId: string;
  extensionId: string;
  extensionName?: string;
  mode: CollectorContribution['mode'];
  activityTypes: string[];
  pollIntervalMs?: number;
  authSchema?: CollectorContribution['authSchema'];
  hostAllowlist: string[];
  /** The extension module's impl (`collect`/`onWebhook`), resolved by the
   *  trusted adapter from `module.collectors[collectorId]`. */
  impl?: CollectorExtension;
}

/** What the trusted adapter hands the registry per extension activation. */
export interface CollectorBundle {
  extensionId: string;
  extensionName?: string;
  collectors: CollectorContribution[];
  activityDisplay: ActivityDisplayContribution[];
  entityTypes: EntityTypeContribution[];
  /** collectorId → impl. Missing entries leave `impl` undefined (a declared
   *  collector without runtime code — polling skips it with a warn). */
  impls?: Record<string, CollectorExtension>;
}

/** Pure merge of all active bundles → registry tables (exported for tests). */
export function buildActivityRegistry(bundles: CollectorBundle[]): {
  collectors: CollectorRegistration[];
  displayByType: Record<string, DisplayIndexEntry>;
  entityTypes: RegisteredEntityType[];
  conflicts: EntityTypeConflict[];
} {
  const collectors: CollectorRegistration[] = [];
  const displayByType: Record<string, DisplayIndexEntry> = {};
  const entityTypes: RegisteredEntityType[] = [...BUILTIN_ENTITY_TYPES];
  const conflicts: EntityTypeConflict[] = [];

  for (const bundle of bundles) {
    // entityTypes: first registrant wins; later collisions skipped + recorded.
    for (const et of bundle.entityTypes) {
      const winner = entityTypes.find((t) => t.id === et.id);
      if (winner) {
        conflicts.push({ typeId: et.id, extensionId: bundle.extensionId, winner: winner.owner });
        console.warn(
          `[activity] extension "${bundle.extensionId}" entity type "${et.id}" conflicts with "${winner.owner}" — skipped`,
        );
        continue;
      }
      entityTypes.push({ ...et, owner: bundle.extensionId });
    }

    // activityDisplay: first declaration per event type wins.
    for (const d of bundle.activityDisplay) {
      if (displayByType[d.type]) {
        console.warn(
          `[activity] extension "${bundle.extensionId}" activityDisplay type "${d.type}" already declared by "${displayByType[d.type].collectorId}" — skipped`,
        );
        continue;
      }
      displayByType[d.type] = { ...d, collectorId: bundle.extensionId };
    }

    // collectors: unique collectorId (it keys the cursor table + event source).
    for (const c of bundle.collectors) {
      if (collectors.some((x) => x.collectorId === c.id)) {
        console.warn(
          `[activity] extension "${bundle.extensionId}" collector "${c.id}" already registered — skipped`,
        );
        continue;
      }
      collectors.push({
        collectorId: c.id,
        extensionId: bundle.extensionId,
        extensionName: bundle.extensionName,
        mode: c.mode,
        activityTypes: c.activityTypes,
        pollIntervalMs: c.pollIntervalMs,
        authSchema: c.authSchema,
        hostAllowlist: c.hostAllowlist,
        impl: bundle.impls?.[c.id],
      });
    }
  }

  return { collectors, displayByType, entityTypes, conflicts };
}

/** Rebuild state from the bundle list. Same input → same output, so
 *  register/unregister are idempotent per extension. */
function rebuild(bundles: CollectorBundle[]) {
  return { bundles, ...buildActivityRegistry(bundles) };
}

interface CollectorRegistryState {
  bundles: CollectorBundle[];
  collectors: CollectorRegistration[];
  displayByType: Record<string, DisplayIndexEntry>;
  entityTypes: RegisteredEntityType[];
  conflicts: EntityTypeConflict[];

  /** Register/replace one extension's bundle (re-registers on re-activation). */
  register: (bundle: CollectorBundle) => void;
  /** Drop an extension's bundle (deactivate/uninstall). */
  unregister: (extensionId: string) => void;
}

export const useCollectorRegistryStore = create<CollectorRegistryState>((set, get) => ({
  bundles: [],
  collectors: [],
  displayByType: {},
  entityTypes: BUILTIN_ENTITY_TYPES,
  conflicts: [],

  register: (bundle) =>
    set(rebuild([...get().bundles.filter((b) => b.extensionId !== bundle.extensionId), bundle])),

  unregister: (extensionId) =>
    set(rebuild(get().bundles.filter((b) => b.extensionId !== extensionId))),
}));
