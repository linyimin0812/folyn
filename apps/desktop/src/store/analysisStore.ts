import { create } from 'zustand';
import type { VaultEntry } from '@quill/vault-provider';
import { useVaultStore } from './vaultStore';
import {
  analyzeProject,
  generateReport,
  saveReport,
  type ReportLanguage,
  type GeneratedReport,
} from '@/services/githubAnalysisService';

interface ReportFile {
  path: string;
  name: string;
}

export interface ReportMeta {
  path: string;
  name: string;
  tags: string[];
}

export interface PendingReport {
  tags: string[];
  html: string;
  repo: string;
  url: string;
  language: ReportLanguage;
}

interface AnalysisState {
  reports: ReportMeta[];
  isLoading: boolean;
  isAnalyzing: boolean;
  error: string | null;
  analysisProgress: string;

  /** Pending report awaiting user confirmation */
  pendingReport: PendingReport | null;
  /** Path of old report to delete after saving (regenerate mode) */
  pendingOverwritePath: string | null;

  loadReports: () => Promise<void>;
  /** Backward-compatible one-shot analysis */
  startAnalysis: (url: string, language: ReportLanguage) => Promise<string>;
  /** Phase 1: Generate report data without saving */
  generateAnalysis: (url: string, language: ReportLanguage) => Promise<void>;
  /** Phase 2: Save with user-confirmed tags */
  confirmAnalysis: (tags: string[]) => Promise<string>;
  /** Cancel the pending report */
  cancelAnalysis: () => void;
  /** Set the path of an old report to delete after saving (regenerate mode) */
  setPendingOverwritePath: (path: string | null) => void;
  deleteReport: (reportPath: string) => Promise<void>;

  // Tag management
  getAllTags: () => string[];
  getReportsByTag: (tag: string) => ReportMeta[];
  removeTag: (reportPath: string, tag: string) => Promise<void>;
  saveTags: (reportPath: string, tags: string[]) => Promise<void>;

  // Deduplication
  findExistingReport: (repoName: string) => ReportMeta | undefined;
}

/** Derive sidecar .tags.json path from a report HTML path */
function getSidecarPath(reportPath: string): string {
  return reportPath.replace(/\.html$/, '.tags.json');
}

/** Recursively collect all .html file entries from a nested VaultEntry tree */
function flattenHtmlFiles(entries: VaultEntry[]): ReportFile[] {
  const result: ReportFile[] = [];
  for (const entry of entries) {
    if (entry.type === 'file' && entry.name.endsWith('.html')) {
      result.push({ path: entry.path, name: entry.name });
    }
    if (entry.type === 'dir' && entry.children) {
      result.push(...flattenHtmlFiles(entry.children));
    }
  }
  return result;
}

/** Read tags from sidecar JSON file; returns empty array if not found */
async function readTags(reportPath: string): Promise<string[]> {
  const vault = useVaultStore.getState();
  const sidecarPath = getSidecarPath(reportPath);
  try {
    const content = await vault.readFile(sidecarPath);
    const data = JSON.parse(content);
    if (data && Array.isArray(data.tags)) {
      return data.tags.map((t: unknown) => String(t).toLowerCase().trim()).filter(Boolean);
    }
  } catch {
    // Sidecar doesn't exist or is invalid
  }
  return [];
}

/** Write tags to sidecar JSON file */
async function writeTags(reportPath: string, tags: string[]): Promise<void> {
  const vault = useVaultStore.getState();
  const sidecarPath = getSidecarPath(reportPath);
  await vault.createFile(sidecarPath, JSON.stringify({ tags }, null, 2));
}

/** Extract repo name from a report filename like "2026-06-13-repo-name.html" */
function parseRepoName(filename: string): string {
  return filename.replace(/^\d{4}-\d{2}-\d{2}-/, '').replace(/\.html$/, '');
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  reports: [],
  isLoading: false,
  isAnalyzing: false,
  error: null,
  analysisProgress: '',
  pendingReport: null,
  pendingOverwritePath: null,

  loadReports: async () => {
    if (get().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      const manager = useVaultStore.getState().manager;
      const entries = await manager.listFiles('reports', true, false).catch(() => []);
      const htmlFiles = flattenHtmlFiles(entries).sort((a, b) =>
        b.name.localeCompare(a.name),
      );

      // Read tags for each report
      const reports: ReportMeta[] = await Promise.all(
        htmlFiles.map(async (file) => ({
          path: file.path,
          name: file.name,
          tags: await readTags(file.path),
        })),
      );

      set({ reports });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ isLoading: false });
    }
  },

  startAnalysis: async (url: string, language: ReportLanguage) => {
    if (get().isAnalyzing) throw new Error('分析正在进行中');
    set({ isAnalyzing: true, error: null, analysisProgress: '' });
    try {
      const filePath = await analyzeProject(url, language, (msg) => {
        set({ analysisProgress: msg });
      });
      await get().loadReports();
      return filePath;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ isAnalyzing: false, analysisProgress: '' });
    }
  },

  generateAnalysis: async (url: string, language: ReportLanguage) => {
    if (get().isAnalyzing) throw new Error('分析正在进行中');
    set({ isAnalyzing: true, error: null, analysisProgress: '', pendingReport: null });
    try {
      const result: GeneratedReport = await generateReport(url, language, (msg) => {
        set({ analysisProgress: msg });
      });
      set({
        pendingReport: {
          tags: result.tags,
          html: result.html,
          repo: result.repo,
          url,
          language,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ isAnalyzing: false, analysisProgress: '' });
    }
  },

  confirmAnalysis: async (tags: string[]) => {
    const { pendingReport, pendingOverwritePath } = get();
    if (!pendingReport) throw new Error('没有待确认的报告');

    set({ isAnalyzing: true, error: null, analysisProgress: '正在保存报告...' });
    try {
      const normalizedTags = tags.map((t) => t.toLowerCase().trim()).filter(Boolean);
      const filePath = await saveReport(pendingReport.repo, normalizedTags, pendingReport.html);

      // Delete old report if regenerating
      if (pendingOverwritePath) {
        try {
          const vault = useVaultStore.getState();
          await vault.deleteFile(pendingOverwritePath);
          const sidecarPath = pendingOverwritePath.replace(/\.html$/, '.tags.json');
          try {
            await vault.deleteFile(sidecarPath);
          } catch {
            // Sidecar might not exist
          }
        } catch {
          console.warn('[analysisStore] Failed to delete old report:', pendingOverwritePath);
        }
      }

      set({ pendingReport: null, pendingOverwritePath: null });
      await get().loadReports();
      return filePath;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ error: msg });
      throw new Error(msg);
    } finally {
      set({ isAnalyzing: false, analysisProgress: '' });
    }
  },

  cancelAnalysis: () => {
    set({ pendingReport: null, pendingOverwritePath: null, error: null, analysisProgress: '' });
  },

  setPendingOverwritePath: (path: string | null) => {
    set({ pendingOverwritePath: path });
  },

  deleteReport: async (reportPath: string) => {
    try {
      const vault = useVaultStore.getState();
      // Delete HTML file
      await vault.deleteFile(reportPath);
      // Delete sidecar tags file if exists
      const sidecarPath = getSidecarPath(reportPath);
      try {
        await vault.deleteFile(sidecarPath);
      } catch {
        // Sidecar might not exist
      }
      await get().loadReports();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  getAllTags: () => {
    const { reports } = get();
    const tagSet = new Set<string>();
    for (const report of reports) {
      for (const tag of report.tags) {
        tagSet.add(tag);
      }
    }
    return Array.from(tagSet).sort();
  },

  getReportsByTag: (tag: string) => {
    const { reports } = get();
    return reports.filter((r) => r.tags.includes(tag));
  },

  removeTag: async (reportPath: string, tag: string) => {
    const report = get().reports.find((r) => r.path === reportPath);
    if (!report) return;

    const newTags = report.tags.filter((t) => t !== tag);

    try {
      if (newTags.length === 0) {
        // No more tags — delete the report entirely
        await get().deleteReport(reportPath);
      } else {
        // Update sidecar with remaining tags
        await writeTags(reportPath, newTags);
        await get().loadReports();
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  saveTags: async (reportPath: string, tags: string[]) => {
    try {
      const normalized = tags.map((t) => t.toLowerCase().trim()).filter(Boolean);
      if (normalized.length > 0) {
        await writeTags(reportPath, normalized);
      } else {
        // Remove sidecar if no tags
        const vault = useVaultStore.getState();
        const sidecarPath = getSidecarPath(reportPath);
        try {
          await vault.deleteFile(sidecarPath);
        } catch {
          // Might not exist
        }
      }
      await get().loadReports();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  findExistingReport: (repoName: string) => {
    const { reports } = get();
    const normalized = repoName.toLowerCase().trim();
    return reports.find((r) => parseRepoName(r.name).toLowerCase() === normalized);
  },
}));
