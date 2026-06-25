import { describe, it, expect, beforeEach } from 'vitest';
import { useSkillStore } from './skillStore';
import { builtinSkills } from '@/services/skillDefaults';
import { storageClient } from '@/utils/storageClient';

beforeEach(() => {
  storageClient.__resetForTesting();
  useSkillStore.setState({ skills: {}, capabilitySkills: { clip: 'clip-card', 'github-analysis': 'github-analysis' } });
});

describe('useSkillStore.getSkill', () => {
  it('returns built-in skills by id', () => {
    expect(useSkillStore.getState().getSkill('clip-card')?.id).toBe('clip-card');
    expect(useSkillStore.getState().getSkill('github-analysis')?.id).toBe('github-analysis');
  });

  it('returns undefined for unknown ids', () => {
    expect(useSkillStore.getState().getSkill('nope')).toBeUndefined();
  });

  it('returns user override over built-in', () => {
    useSkillStore.getState().updateSkill('clip-card', { name: 'My Clip' });
    expect(useSkillStore.getState().getSkill('clip-card')?.name).toBe('My Clip');
  });
});

describe('useSkillStore.getAllSkills', () => {
  it('returns built-in skills merged with user skills', () => {
    useSkillStore.getState().createSkill({ id: 'custom', name: 'C', content: 'x', version: '1.0.0', builtin: false, outputFormat: 'json', description: '' });
    const all = useSkillStore.getState().getAllSkills();
    const ids = all.map((s) => s.id).sort();
    expect(ids).toEqual(['clip-card', 'custom', 'github-analysis']);
  });
});

describe('useSkillStore.getSkillForCapability', () => {
  it('resolves the registered skill for a capability', () => {
    expect(useSkillStore.getState().getSkillForCapability('clip')?.id).toBe('clip-card');
  });

  it('returns undefined for an unmapped capability', () => {
    expect(useSkillStore.getState().getSkillForCapability('unknown-cap')).toBeUndefined();
  });
});

describe('useSkillStore.setCapabilitySkill', () => {
  it('updates the capability → skill mapping', () => {
    useSkillStore.getState().createSkill({ id: 'custom', name: 'C', content: 'x', version: '1.0.0', builtin: false, outputFormat: 'json', description: '' });
    useSkillStore.getState().setCapabilitySkill('clip', 'custom');
    expect(useSkillStore.getState().getSkillForCapability('clip')?.id).toBe('custom');
  });
});

describe('useSkillStore.updateSkill', () => {
  it('merges updates into an existing skill, keeping id immutable', () => {
    useSkillStore.getState().updateSkill('clip-card', { name: 'Renamed' });
    const skill = useSkillStore.getState().getSkill('clip-card')!;
    expect(skill.name).toBe('Renamed');
    expect(skill.id).toBe('clip-card');
    expect(skill.builtin).toBe(true);
  });

  it('ignores updates for unknown skill ids', () => {
    useSkillStore.getState().updateSkill('nope', { name: 'x' });
    expect(useSkillStore.getState().getSkill('nope')).toBeUndefined();
  });
});

describe('useSkillStore.resetSkill', () => {
  it('reverts a user override on a built-in skill', () => {
    useSkillStore.getState().updateSkill('clip-card', { name: 'Override' });
    useSkillStore.getState().resetSkill('clip-card');
    expect(useSkillStore.getState().getSkill('clip-card')?.name).toBe(builtinSkills['clip-card'].name);
  });

  it('does nothing for non-builtin ids', () => {
    useSkillStore.getState().createSkill({ id: 'custom', name: 'C', content: 'x', version: '1.0.0', builtin: false, outputFormat: 'json', description: '' });
    useSkillStore.getState().resetSkill('custom');
    expect(useSkillStore.getState().getSkill('custom')?.name).toBe('C');
  });
});

describe('useSkillStore.createSkill / deleteSkill', () => {
  it('creates a custom skill marked builtin=false', () => {
    useSkillStore.getState().createSkill({ id: 'mine', name: 'M', content: 'x', version: '1.0.0', builtin: true, outputFormat: 'json', description: '' });
    const s = useSkillStore.getState().getSkill('mine')!;
    expect(s.builtin).toBe(false);
  });

  it('rejects creating a skill with a built-in id', () => {
    expect(() =>
      useSkillStore.getState().createSkill({ id: 'clip-card', name: 'x', content: 'y', version: '1.0.0', builtin: false, outputFormat: 'json', description: '' }),
    ).toThrow();
  });

  it('deletes a custom skill', () => {
    useSkillStore.getState().createSkill({ id: 'mine', name: 'M', content: 'x', version: '1.0.0', builtin: false, outputFormat: 'json', description: '' });
    useSkillStore.getState().deleteSkill('mine');
    expect(useSkillStore.getState().getSkill('mine')).toBeUndefined();
  });

  it('rejects deleting a built-in skill', () => {
    expect(() => useSkillStore.getState().deleteSkill('clip-card')).toThrow();
  });
});

describe('useSkillStore.importSkill / exportSkill', () => {
  it('round-trips a custom skill through export and import', () => {
    useSkillStore.getState().createSkill({ id: 'mine', name: 'M', content: 'body', version: '1.0.0', builtin: false, outputFormat: 'json', description: 'd' });
    const json = useSkillStore.getState().exportSkill('mine');
    useSkillStore.getState().deleteSkill('mine');
    useSkillStore.getState().importSkill(json);
    expect(useSkillStore.getState().getSkill('mine')?.content).toBe('body');
  });

  it('importSkill rejects malformed JSON', () => {
    expect(() => useSkillStore.getState().importSkill('{not json')).toThrow(/JSON|parse/i);
  });

  it('importSkill rejects missing required fields', () => {
    expect(() => useSkillStore.getState().importSkill(JSON.stringify({ id: 'x' }))).toThrow(/id|content|name/i);
  });

  it('importSkill on a built-in id updates the built-in skill', () => {
    useSkillStore.getState().importSkill(JSON.stringify({ id: 'clip-card', name: 'Imported', content: 'x', version: '1.0.0', outputFormat: 'json' }));
    expect(useSkillStore.getState().getSkill('clip-card')?.name).toBe('Imported');
  });

  it('exportSkill throws for unknown ids', () => {
    expect(() => useSkillStore.getState().exportSkill('nope')).toThrow();
  });
});
