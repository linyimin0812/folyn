export type WikiPageType = 'entity' | 'concept' | 'source' | 'comparison' | 'synthesis';

export interface WikiFrontmatter {
  title: string;
  type: WikiPageType;
  sources: string[];
  tags: string[];
  created: string;
  updated: string;
  confidence: 'high' | 'medium' | 'low';
  related: string[];
}

export interface WikiEntry {
  path: string;
  name: string;
  type: 'file' | 'dir';
  children?: WikiEntry[];
}

export interface IngestTask {
  id: string;
  filePath: string;
  status: 'pending' | 'analyzing' | 'generating' | 'done' | 'error';
  error?: string;
}

export interface ReviewItem {
  id: string;
  type: 'contradiction' | 'low_confidence' | 'merge_suggestion' | 'structure_change' | 'stale_content';
  title: string;
  description: string;
  affectedPages: string[];
  suggestedActions: ReviewAction[];
  createdAt: number;
  status: 'pending' | 'resolved' | 'dismissed';
}

export interface ReviewAction {
  label: string;
  type: 'accept' | 'reject' | 'merge' | 'research' | 'custom';
  preview?: string;
}

export interface IngestAnalysis {
  entities: { name: string; type: string; description: string }[];
  concepts: { name: string; definition: string }[];
  connections: { from: string; to: string; relationship: string }[];
  contradictions: { claim: string; vs: string; existingSource: string }[];
  structureRecommendations: string[];
}

export interface WikiGraphNode {
  id: string;
  label: string;
  type: 'user-file' | 'entity' | 'concept' | 'source' | 'synthesis';
  linkCount: number;
  tags: string[];
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface WikiGraphEdge {
  source: string;
  target: string;
  weight: number;
  signals: {
    directLink: boolean;
    sourceOverlap: boolean;
    adamicAdar: number;
    typeAffinity: number;
  };
}

export const WIKI_DIR = 'quill-wiki';
export const WIKI_PREFIX = 'wiki://';
