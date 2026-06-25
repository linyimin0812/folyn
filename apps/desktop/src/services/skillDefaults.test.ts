import { describe, it, expect } from 'vitest';
import { builtinSkills } from './skillDefaults';
import type { Skill } from '@/types/skill';

describe('builtinSkills', () => {
  it('contains clip-card and github-analysis skills', () => {
    expect(Object.keys(builtinSkills).sort()).toEqual(['clip-card', 'github-analysis']);
  });

  it('every skill is marked builtin and has a non-empty content', () => {
    for (const skill of Object.values(builtinSkills)) {
      expect(skill.builtin).toBe(true);
      expect(skill.content.length).toBeGreaterThan(0);
      expect(skill.version).toMatch(/^\d+\.\d+\.\d+$/);
    }
  });

  it('clip-card skill outputs JSON', () => {
    const s: Skill = builtinSkills['clip-card'];
    expect(s.outputFormat).toBe('json');
    expect(s.content).toContain('WebFetch');
    expect(s.content).toContain('tags');
  });

  it('github-analysis skill outputs tags + html', () => {
    const s: Skill = builtinSkills['github-analysis'];
    expect(s.outputFormat).toBe('tags-html');
    expect(s.content).toContain('git clone');
    expect(s.content).toContain('---TAGS---');
  });

  it('forbids file-write tools in skill instructions', () => {
    // Both skills explicitly tell the model not to save to disk.
    for (const s of Object.values(builtinSkills)) {
      expect(s.content.toLowerCase()).toMatch(/do not.*write|do not.*save|不要.*write|不要.*保存/);
    }
  });
});
