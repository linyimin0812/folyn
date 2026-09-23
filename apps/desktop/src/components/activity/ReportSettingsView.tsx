/**
 * 报告设置 rail view (report customization design): per-period LLM prompt
 * textareas (empty = deterministic template), one (provider, model) override
 * for all reports (default: follow the global chat pair), and the
 * vault-relative report root dir. Everything saves to
 * activityCollectorStore.reportConfig immediately — the store persists.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PairSelector } from '@/components/ai/PairSelector';
import { useActivityCollectorStore } from '@/store/activityCollectorStore';

const PERIODS = ['daily', 'weekly', 'monthly'] as const;
type Period = (typeof PERIODS)[number];

export function ReportSettingsView() {
  const { t } = useTranslation();
  const reportConfig = useActivityCollectorStore((s) => s.reportConfig);
  const setReportPrompt = useActivityCollectorStore((s) => s.setReportPrompt);
  const setReportModelOverride = useActivityCollectorStore((s) => s.setReportModelOverride);
  const setReportRootDir = useActivityCollectorStore((s) => s.setReportRootDir);
  const [period, setPeriod] = useState<Period>('daily');

  return (
    <div className="max-w-[720px]">
      {/* Period tabs → one prompt textarea each (reuses report.daily/… labels). */}
      <div className="inline-flex gap-1 mb-4">
        {PERIODS.map((p) => (
          <button
            key={p}
            className={`px-4 py-1.5 rounded-full text-[13px] border cursor-pointer ${
              period === p
                ? 'border-transparent bg-accdim text-acc'
                : 'border-brd bg-transparent text-t2 hover:bg-hov'
            }`}
            onClick={() => setPeriod(p)}
          >
            {t(`activity:report.${p}`)}
          </button>
        ))}
      </div>

      <label className="block mb-6">
        <span className="block text-[13px] text-t1 mb-1.5">
          {t('activity:reportSettings.promptLabel')}
        </span>
        <textarea
          className="w-full text-[13px] bg-surf2 border border-brd2 rounded-md px-3 py-2 text-t1 leading-relaxed resize-y outline-none transition-[border-color] duration-100 focus:border-acc"
          rows={10}
          value={reportConfig.prompts[period]}
          placeholder={t('activity:reportSettings.promptPlaceholder')}
          onChange={(e) => setReportPrompt(period, e.target.value)}
        />
        <span className="block mt-1.5 text-[11px] text-t3">
          {t('activity:reportSettings.promptHint')}
        </span>
      </label>

      <div className="py-4 border-t border-b border-brd mb-6">
        <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
          <span className="text-[13px] text-t1">{t('activity:reportSettings.modelLabel')}</span>
          {reportConfig.modelOverride ? (
            <button
              className="btn btn-sm"
              onClick={() => setReportModelOverride(null)}
            >
              {t('activity:reportSettings.followGlobal')}
            </button>
          ) : (
            <span className="text-[11px] text-t3">{t('activity:reportSettings.followGlobalHint')}</span>
          )}
        </div>
        <div className="w-[360px] max-w-full">
          <PairSelector
            className="w-full"
            value={reportConfig.modelOverride ?? null}
            onChange={(pair) => setReportModelOverride(pair)}
            dropDirection="down"
            panelAlign="right"
            panelMatchWidth
          />
        </div>
      </div>

      <label className="block">
        <span className="block text-[13px] text-t1 mb-1.5">
          {t('activity:reportSettings.rootDirLabel')}
        </span>
        <input
          className="w-full max-w-[360px] text-[13px] bg-surf2 border border-brd2 rounded-md px-3 py-1.5 text-t1 outline-none transition-[border-color] duration-100 focus:border-acc"
          value={reportConfig.rootDir}
          placeholder={t('activity:reportSettings.rootDirPlaceholder')}
          onChange={(e) => setReportRootDir(e.target.value)}
        />
      </label>
    </div>
  );
}
