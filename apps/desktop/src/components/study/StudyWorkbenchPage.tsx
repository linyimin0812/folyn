import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudyStore, subscribeToFileTree } from '@/store/studyStore';
import { useScheduleStore } from '@/store/scheduleStore';
import { useAiStore } from '@/store/aiStore';
import { useSettingsStore } from '@/store/settingsStore';
import { StudyTopicList } from './StudyTopicList';
import { StudyMaterialsSection } from './StudyMaterialsSection';
import { StudyPlanSection } from './StudyPlanSection';
import { StudyNotesSection } from './StudyNotesSection';
import { StudyReviewSection } from './StudyReviewSection';
import { TodayReviewQueue } from './TodayReviewQueue';
import { collectScheduleLinks, isAiAvailable, openStudyAiAction, buildStudyPrompt, type ScheduleLink } from '@/study/scheduleLink';
import { computePlanProgress } from '@/study/progress';
import type { StudyMaterial, StudyUnit, ReviewAtom } from '@/study/types';

/** 学习工作台视图：主题主区四区，或跨主题今日复习队列（交错练习）。 */
export type StudyView = 'topic' | 'today';

/**
 * 学习工作台页壳。PR3：主题列表 + 四区主视图 + 今日复习切换。
 * PR6：四区卡片化重设计 + diff 审阅入口横幅（订阅 aiStore 当前会话的待审阅编辑）。
 */
export function StudyWorkbenchPage() {
  const refresh = useStudyStore((s) => s.refresh);
  const scheduleRefresh = useScheduleStore((s) => s.refresh);
  const [view, setView] = useState<StudyView>('topic');

  useEffect(() => {
    refresh();
    // 同步刷新 schedule 任务缓存，供计划区回链读回（scanScheduleLinks）。
    scheduleRefresh().catch(() => {});
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = subscribeToFileTree(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => refresh(), 300);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, [refresh, scheduleRefresh]);

  const activeSlug = useStudyStore((s) => s.activeSlug);
  const topics = useStudyStore((s) => s.topics);
  const saveTopicEdits = useStudyStore((s) => s.saveTopicEdits);
  const scheduleUnitToToday = useStudyStore((s) => s.scheduleUnitToToday);
  const suggestedMaterials = useStudyStore((s) => s.suggestedMaterials);
  const suggestedUnits = useStudyStore((s) => s.suggestedUnits);
  const pendingSuggestion = useStudyStore((s) => s.pendingSuggestion);
  const beginSuggestion = useStudyStore((s) => s.beginSuggestion);
  const consumeSuggestion = useStudyStore((s) => s.consumeSuggestion);
  const clearSuggestions = useStudyStore((s) => s.clearSuggestions);
  const acceptMaterialSuggestion = useStudyStore((s) => s.acceptMaterialSuggestion);
  const dismissMaterialSuggestion = useStudyStore((s) => s.dismissMaterialSuggestion);
  const acceptUnitSuggestion = useStudyStore((s) => s.acceptUnitSuggestion);
  const dismissUnitSuggestion = useStudyStore((s) => s.dismissUnitSuggestion);
  const active = topics.find((t) => t.slug === activeSlug) ?? null;

  // 计划区回链状态：扫描 schedule 任务中带 study:<slug> 的条目（只读单向读回）。
  const scheduleTasks = useScheduleStore((s) => s.tasks);
  const scheduleLinks = active
    ? collectScheduleLinks(scheduleTasks, active.slug)
    : new Map<number, ScheduleLink>();

  // diff 审阅入口横幅：当前 AI 会话中针对当前主题文档的待审阅编辑数。
  // aiSessions/aiActiveId 同时供下方 AI 建议文本捕获 effect 复用。
  const aiSessions = useAiStore((s) => s.sessions);
  const aiActiveId = useAiStore((s) => s.activeSessionId);
  const updateSettings = useSettingsStore((s) => s.updateSettings);
  const pendingDiffCount = useMemo(() => {
    if (!active) return 0;
    const sess = aiSessions.find((s) => s.id === aiActiveId);
    if (!sess) return 0;
    return sess.fileChanges.filter(
      (c) => c.path === active.path && c.status === 'pending',
    ).length;
  }, [aiSessions, aiActiveId, active]);

  const goReviewDiff = () => {
    updateSettings({ currentPage: 'editor' });
  };

  // ── AI 建议文本捕获（research/plan）──
  // pendingSuggestion 置位后，监听 aiStore 活跃会话：流式结束后扫描"新产生的"
  // 最后一条 assistant 消息文本 → 填充 suggestedMaterials/suggestedUnits，清 pending。
  // 关键：发起动作时先把当前最后一条 assistant 消息 id 记为 baseline（markSuggestionBaseline），
  // 避免把动作发起前就已存在的旧 assistant 消息误当作本次产出消费掉、提前清掉 pending。
  const lastScannedMsgId = useRef<string | null>(null);
  const markSuggestionBaseline = () => {
    const sess = aiSessions.find((s) => s.id === aiActiveId);
    const last = sess ? [...sess.messages].reverse().find((m) => m.role === 'assistant') : null;
    lastScannedMsgId.current = last?.id ?? null;
  };
  useEffect(() => {
    if (!pendingSuggestion) return;
    const sess = aiSessions.find((s) => s.id === aiActiveId);
    if (!sess || sess.isStreaming) return;
    const lastAssistant = [...sess.messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;
    if (lastScannedMsgId.current === lastAssistant.id) return;
    lastScannedMsgId.current = lastAssistant.id;
    consumeSuggestion(lastAssistant.content);
  }, [aiSessions, aiActiveId, pendingSuggestion, consumeSuggestion]);

  // 切换主题时清空旧建议（避免上一个主题的建议残留）。
  useEffect(() => {
    clearSuggestions();
    lastScannedMsgId.current = null;
  }, [activeSlug, clearSuggestions]);

  // ── 写回路径（均走 saveTopicEdits → serializeStudy，以缓存原始 parsed 为第一参数，
  //     非托管行原样保留；删除/编辑/新增均正确）──
  const addMaterial = async (m: StudyMaterial) => {
    if (!active) return;
    await saveTopicEdits(active.slug, { materials: [...active.parsed.materials, m] });
  };
  const editMaterial = async (m: StudyMaterial) => {
    if (!active) return;
    const materials = active.parsed.materials.map((x) => (x.id === m.id ? m : x));
    await saveTopicEdits(active.slug, { materials });
  };
  const deleteMaterial = async (id: string) => {
    if (!active) return;
    const materials = active.parsed.materials.filter((x) => x.id !== id);
    await saveTopicEdits(active.slug, { materials });
  };
  const toggleUnit = async (unit: StudyUnit) => {
    if (!active) return;
    const units = active.parsed.units.map((u) => (u.id === unit.id ? unit : u));
    await saveTopicEdits(active.slug, { units });
  };
  const addUnit = async (u: StudyUnit) => {
    if (!active) return;
    await saveTopicEdits(active.slug, { units: [...active.parsed.units, u] });
  };
  const rateAtom = async (_prev: ReviewAtom, next: ReviewAtom) => {
    if (!active) return;
    const reviewAtoms = active.parsed.reviewAtoms.map((a) =>
      a.lineIndex === next.lineIndex ? { ...a, ...next } : a,
    );
    await saveTopicEdits(active.slug, { reviewAtoms });
  };
  const addReviewAtom = async (atom: ReviewAtom) => {
    if (!active) return;
    await saveTopicEdits(active.slug, { reviewAtoms: [...active.parsed.reviewAtoms, atom] });
  };
  const onScheduleUnit = async (unit: StudyUnit, noteDate: string) => {
    if (!active) return;
    await scheduleUnitToToday(unit, active.slug, noteDate);
  };

  // ── AI 动作入口（research/plan 走建议卡片；feynman/selftest/sq3r 仍直编+diff）──
  const runResearch = () => {
    if (!active || !isAiAvailable()) return;
    markSuggestionBaseline();
    beginSuggestion('research', active.slug);
    openStudyAiAction(
      active.parsed.frontmatter.title ?? active.slug,
      active.path,
      buildStudyPrompt('research', { topicName: active.parsed.frontmatter.title ?? active.slug, topicPath: active.path }),
      { openFile: false },
    );
  };
  const runPlanFromSelected = (selected: StudyMaterial[]) => {
    if (!active || !isAiAvailable()) return;
    markSuggestionBaseline();
    beginSuggestion('plan', active.slug);
    openStudyAiAction(
      active.parsed.frontmatter.title ?? active.slug,
      active.path,
      buildStudyPrompt('plan', {
        topicName: active.parsed.frontmatter.title ?? active.slug,
        topicPath: active.path,
        selectedMaterials: selected,
      }),
      { openFile: false },
    );
  };

  const planProgress = useMemo(
    () => (active ? computePlanProgress(active.parsed.units) : null),
    [active],
  );

  return (
    <div className="study-workbench schedule-workbench">
      <StudyTopicList onCreated={() => setView('topic')} />

      <main className="sw-main">
        <div className="sw-study-body">
          <div className="sw-study-topbar">
            <div className="sw-study-topbar-left">
              <div className="sw-study-view-switch">
                <button className={view === 'topic' ? 'active' : ''} onClick={() => setView('topic')} aria-pressed={view === 'topic'}>主题</button>
                <button className={view === 'today' ? 'active' : ''} onClick={() => setView('today')} aria-pressed={view === 'today'}>今日复习</button>
              </div>
              {active && view === 'topic' && planProgress && planProgress.total > 0 && (
                <span className="sw-study-topbar-progress" title="计划总体进度">
                  <span className="sw-study-topbar-progress-pct">{planProgress.percent}%</span>
                  <span className="sw-study-count">{planProgress.done}/{planProgress.total}</span>
                </span>
              )}
            </div>
            {pendingDiffCount > 0 && (
              <button className="sw-diff-banner" onClick={goReviewDiff} title="跳到编辑器审阅 AI 提议的编辑">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
                AI 提议了 {pendingDiffCount} 处编辑，点击审阅
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
              </button>
            )}
          </div>

          {view === 'today' ? (
            <TodayReviewQueue onShowTopic={() => setView('topic')} />
          ) : active ? (
            <div className="sw-study-grid">
              <h2 className="sw-topbar-title">{active.parsed.frontmatter.title ?? active.slug}</h2>
              <StudyMaterialsSection
                slug={active.slug}
                path={active.path}
                topicName={active.parsed.frontmatter.title ?? active.slug}
                materials={active.parsed.materials}
                suggestedMaterials={suggestedMaterials}
                onAdd={addMaterial}
                onEdit={editMaterial}
                onDelete={deleteMaterial}
                onAcceptSuggestion={(m) => acceptMaterialSuggestion(active.slug, m)}
                onDismissSuggestion={dismissMaterialSuggestion}
                onResearch={runResearch}
                onGeneratePlanFromSelected={runPlanFromSelected}
              />
              <StudyPlanSection
                path={active.path}
                topicName={active.parsed.frontmatter.title ?? active.slug}
                units={active.parsed.units}
                suggestedUnits={suggestedUnits}
                scheduleLinks={scheduleLinks}
                onToggle={toggleUnit}
                onAdd={addUnit}
                onSchedule={onScheduleUnit}
                onGeneratePlan={() => runPlanFromSelected([])}
                onAcceptUnitSuggestion={(u) => acceptUnitSuggestion(active.slug, u)}
                onDismissUnitSuggestion={dismissUnitSuggestion}
              />
              <StudyNotesSection slug={active.slug} path={active.path} topicName={active.parsed.frontmatter.title ?? active.slug} parsed={active.parsed} />
              <StudyReviewSection slug={active.slug} path={active.path} topicName={active.parsed.frontmatter.title ?? active.slug} parsed={active.parsed} onRate={rateAtom} onAdd={addReviewAtom} />
            </div>
          ) : (
            <div className="sw-study-placeholder">
              <h2 className="sw-topbar-title">学习工作站</h2>
              <p className="sw-empty-hint">选择或新建一个学习主题开始。</p>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
