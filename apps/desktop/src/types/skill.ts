export type SkillCapability = 'clip' | 'github-analysis';

export type SkillOutputFormat = 'json' | 'tags-html' | 'markdown' | 'html';

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  builtin: boolean;
  content: string;
  outputFormat: SkillOutputFormat;
}
