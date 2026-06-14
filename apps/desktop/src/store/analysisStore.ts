import { create } from 'zustand';
import type { VaultEntry } from '@quill/vault-provider';
import { useVaultStore } from './vaultStore';
import {
  analyzeProject,
  type ReportLanguage,
} from '@/services/githubAnalysisService';

export interface ReportFile {
  path: string;
  name: string;
}

interface AnalysisState {
  reports: ReportFile[];
  isLoading: boolean;
  isAnalyzing: boolean;
  error: string | null;
  analysisProgress: string;

  loadReports: () => Promise<void>;
  startAnalysis: (url: string, language: ReportLanguage) => Promise<string>;
  deleteReport: (reportPath: string) => Promise<void>;
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

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  reports: [],
  isLoading: false,
  isAnalyzing: false,
  error: null,
  analysisProgress: '',

  loadReports: async () => {
    if (get().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      const manager = useVaultStore.getState().manager;
      const entries = await manager.listFiles('reports', true, false).catch(() => []);
      const reports = flattenHtmlFiles(entries).sort((a, b) =>
        b.name.localeCompare(a.name),
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

  deleteReport: async (reportPath: string) => {
    try {
      const vault = useVaultStore.getState();
      await vault.deleteFile(reportPath);
      await get().loadReports();
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },
}));
