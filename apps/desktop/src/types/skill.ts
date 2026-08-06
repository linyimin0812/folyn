export type SkillCapability = 'clip' | 'github-analysis';

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  builtin: boolean;
  content: string;
}
