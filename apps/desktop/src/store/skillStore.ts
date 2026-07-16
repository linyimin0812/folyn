import { create } from 'zustand';
import { storageClient } from '@/utils/storageClient';
import { debounce } from '@/utils/debounce';
import type { Skill, SkillCapability } from '@/types/skill';
import { builtinSkills } from '@/services/skillDefaults';

const SKILLS_STORAGE_KEY = 'skills:all';
const CAPABILITIES_STORAGE_KEY = 'skills:capabilities';

const DEFAULT_CAPABILITY_SKILLS: Record<SkillCapability, string> = {
  clip: 'clip-card',
  'github-analysis': 'github-analysis',
};

interface SkillState {
  skills: Record<string, Skill>;
  capabilitySkills: Record<SkillCapability, string>;

  getSkill: (id: string) => Skill | undefined;
  getAllSkills: () => Skill[];
  getSkillForCapability: (capability: SkillCapability) => Skill | undefined;
  setCapabilitySkill: (capability: SkillCapability, skillId: string) => void;
  updateSkill: (id: string, updates: Partial<Skill>) => void;
  resetSkill: (id: string) => void;
  createSkill: (skill: Skill) => void;
  deleteSkill: (id: string) => void;
  importSkill: (json: string) => void;
  exportSkill: (id: string) => string;
}

/** Debounced persist — same pattern as settingsPersistence. */
const debouncedPersistSkills = debounce(
  (skills: Record<string, Skill>) => storageClient.set(SKILLS_STORAGE_KEY, skills),
  300,
);

const debouncedPersistCapabilities = debounce(
  (capabilitySkills: Record<SkillCapability, string>) => storageClient.set(CAPABILITIES_STORAGE_KEY, capabilitySkills),
  300,
);

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: {},
  capabilitySkills: { ...DEFAULT_CAPABILITY_SKILLS },

  getSkill: (id) => {
    const { skills } = get();
    // User override takes precedence
    if (skills[id]) return skills[id];
    // Fall back to built-in default
    if (builtinSkills[id]) return builtinSkills[id];
    return undefined;
  },

  getAllSkills: () => {
    const { skills } = get();
    // Start with built-in defaults
    const merged: Record<string, Skill> = { ...builtinSkills };
    // Overlay user modifications and custom skills
    for (const [id, skill] of Object.entries(skills)) {
      merged[id] = skill;
    }
    return Object.values(merged);
  },

  getSkillForCapability: (capability) => {
    const { capabilitySkills } = get();
    const skillId = capabilitySkills[capability];
    if (!skillId) return undefined;
    return get().getSkill(skillId);
  },

  setCapabilitySkill: (capability, skillId) => {
    set((state) => ({
      capabilitySkills: { ...state.capabilitySkills, [capability]: skillId },
    }));
    debouncedPersistCapabilities(get().capabilitySkills);
  },

  updateSkill: (id, updates) => {
    const existing = get().getSkill(id);
    if (!existing) return;

    const updated: Skill = { ...existing, ...updates, id }; // id is immutable
    set((state) => ({
      skills: { ...state.skills, [id]: updated },
    }));
    debouncedPersistSkills(get().skills);
  },

  resetSkill: (id) => {
    // Only reset if it's a built-in skill with a user override
    if (!builtinSkills[id]) return;

    set((state) => {
      const { [id]: _, ...rest } = state.skills;
      return { skills: rest };
    });
    debouncedPersistSkills(get().skills);
  },

  createSkill: (skill) => {
    if (builtinSkills[skill.id]) {
      throw new Error(`Cannot create skill with built-in ID "${skill.id}". Use updateSkill instead.`);
    }
    const newSkill: Skill = { ...skill, builtin: false };
    set((state) => ({
      skills: { ...state.skills, [skill.id]: newSkill },
    }));
    debouncedPersistSkills(get().skills);
  },

  deleteSkill: (id) => {
    if (builtinSkills[id]) {
      throw new Error(`Cannot delete built-in skill "${id}". Use resetSkill to revert modifications.`);
    }
    set((state) => {
      const { [id]: _, ...rest } = state.skills;
      return { skills: rest };
    });
    debouncedPersistSkills(get().skills);
  },

  importSkill: (json) => {
    let parsed: Skill;
    try {
      parsed = JSON.parse(json);
    } catch {
      throw new Error('Invalid JSON: failed to parse skill data.');
    }

    // Validate required fields
    if (!parsed.id || typeof parsed.id !== 'string') {
      throw new Error('Missing required field: "id".');
    }
    if (!parsed.content || typeof parsed.content !== 'string') {
      throw new Error('Missing required field: "content".');
    }
    if (!parsed.name || typeof parsed.name !== 'string') {
      throw new Error('Missing required field: "name".');
    }

    // If it's a built-in ID, treat as an update
    if (builtinSkills[parsed.id]) {
      get().updateSkill(parsed.id, parsed);
    } else {
      // Add as custom skill
      const skill: Skill = {
        id: parsed.id,
        name: parsed.name,
        description: parsed.description || '',
        version: parsed.version || '1.0.0',
        builtin: false,
        content: parsed.content,
        outputFormat: parsed.outputFormat || 'json',
      };
      set((state) => ({
        skills: { ...state.skills, [skill.id]: skill },
      }));
      debouncedPersistSkills(get().skills);
    }
  },

  exportSkill: (id) => {
    const skill = get().getSkill(id);
    if (!skill) {
      throw new Error(`Skill "${id}" not found.`);
    }
    return JSON.stringify(skill, null, 2);
  },
}));

/** Load persisted skills and capability mappings from backend on startup. */
storageClient.get<Record<string, Skill>>(SKILLS_STORAGE_KEY).then((saved) => {
  if (saved && typeof saved === 'object') {
    useSkillStore.setState({ skills: saved });
  }
}).catch((err) => {
  console.warn('[skillStore] Failed to load persisted skills:', err);
});

storageClient.get<Record<SkillCapability, string>>(CAPABILITIES_STORAGE_KEY).then((saved) => {
  if (saved && typeof saved === 'object') {
    useSkillStore.setState({ capabilitySkills: { ...DEFAULT_CAPABILITY_SKILLS, ...saved } });
  }
}).catch((err) => {
  console.warn('[skillStore] Failed to load persisted capability mappings:', err);
});
