import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStudyStore, subscribeToFileTree } from '@/store/studyStore';
import { useScheduleStore } from '@/store/scheduleStore';
import { useAiStore } from '@/store/aiStore';
import { useNavStore } from '@/store/navStore';
import { StudyTopicList } from './StudyTopicList';
import { StudyMaterialsSection } from './StudyMaterialsSection';
import { StudyPlanSection } from './StudyPlanSection';
import { StudyNotesSection } from './StudyNotesSection';
import { StudyReviewSection } from './StudyReviewSection';
import { StudyQuizSection } from './StudyQuizSection';
import { StudyDeletingOverlay } from './StudyDeletingOverlay';
import { StudyGrillCard } from './StudyGrillCard';
import { TodayReviewQueue } from './TodayReviewQueue';
import * as editorIoService from '@/services/editorIoService';
import { collectScheduleLinks, isAiAvailable, openStudyAiAction, buildStudyInstruction, type ScheduleLink } from '@/features/study/scheduleLink';
import { computePlanProgress } from '@/features/study/progress';
import type { StudyMaterial, StudyUnit, ReviewAtom, QuizItem } from '@/features/study/types';

/** 学习工作台视图：主题主区四区，或跨主题今日复习队列（交错练习）。 */
export type StudyView = 'topic' | 'today';

/**
 * 学习工作台页壳。PR3：主题列表 + 四区主视图 + 今日复习切换。
 * PR6：四区卡片化重设计 + diff 审阅入口横幅（订阅 aiStore 当前会话的待审阅编辑）。
 */
export function StudyWorkbenchPage() {
  const { t } = useTranslation();
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
  const suggestedUnits = useStudyStore((s) => s.suggestedUnits);
  const pendingSuggestion = useStudyStore((s) => s.pendingSuggestion);
  const beginSuggestion = useStudyStore((s) => s.beginSuggestion);
  const consumeSuggestion = useStudyStore((s) => s.consumeSuggestion);
  const clearSuggestions = useStudyStore((s) => s.clearSuggestions);
  const acceptUnitSuggestion = useStudyStore((s) => s.acceptUnitSuggestion);
  const dismissUnitSuggestion = useStudyStore((s) => s.dismissUnitSuggestion);
  const activeUnitOrder = useStudyStore((s) => s.activeUnitOrder);
  const setActiveUnit = useStudyStore((s) => s.setActiveUnit);
  const rateQuizItem = useStudyStore((s) => s.rateQuizItem);
  const removingSlug = useStudyStore((s) => s.removingSlug);
  const grillQuestion = useStudyStore((s) => s.grillQuestion);
  const grillRound = useStudyStore((s) => s.grillRound);
  const grillDone = useStudyStore((s) => s.grillDone);
  const grillHistory = useStudyStore((s) => s.grillHistory);
  const clearGrill = useStudyStore((s) => s.clearGrill);
  const addGrillHistory = useStudyStore((s) => s.addGrillHistory);
  const setSq3rOutput = useStudyStore((s) => s.setSq3rOutput);
  const findSq3rSubdoc = useStudyStore((s) => s.findSq3rSubdoc);
  const active = topics.find((t) => t.slug === activeSlug) ?? null;

  // 计划区回链状态：扫描 schedule 任务中带 study:<slug> 的条目（只读单向读回）。
  const scheduleTasks = useScheduleStore((s) => s.tasks);
  const scheduleLinks = active
    ? collectScheduleLinks(scheduleTasks, active.slug)
    : new Map<number, ScheduleLink>();

  // diff 审阅入口横幅：当前主题的专属 study 会话中针对主题文档的待审阅编辑数。
  // aiSessions/studySessionId 同时供下方 AI 建议文本捕获 effect 复用。
  // PR9：study agent 在每个主题的专属 study 会话（aiStore.studySessionIds[slug]）里运行，
  // 上下文按主题隔离；不再用活跃会话——避免用户切到其它会话时捕获/横幅失联。
  const aiSessions = useAiStore((s) => s.sessions);
  const studySessionIds = useAiStore((s) => s.studySessionIds);
  const studySessionId = active ? (studySessionIds[active.slug] ?? null) : null;
  // grill 等待态：pendingSuggestion 为 grill 说明一轮问答在途，卡片显示 spinner 提示。
  const grillPending = pendingSuggestion?.kind === 'grill';
  const setCurrentPage = useNavStore((s) => s.setCurrentPage);
  const pendingDiffCount = useMemo(() => {
    if (!active) return 0;
    const sess = aiSessions.find((s) => s.id === studySessionId);
    if (!sess) return 0;
    return sess.fileChanges.filter(
      (c) => c.path === active.path && c.status === 'pending',
    ).length;
  }, [aiSessions, studySessionId, active]);

  const goReviewDiff = () => {
    setCurrentPage('editor');
  };

  // ── AI 建议文本捕获（research 自动写盘 / plan 建议卡片）──
  // pendingSuggestion 置位后，监听 study 会话：流式结束后扫描"新产生的"
  // 最后一条 assistant 消息文本 → research 自动追加到 `## 资料`、plan 填 suggestedUnits，清 pending。
  // 关键：发起动作时先把当前最后一条 assistant 消息 id 记为 baseline（markSuggestionBaseline），
  // 避免把动作发起前就已存在的旧 assistant 消息误当作本次产出消费掉、提前清掉 pending。
  const lastScannedMsgId = useRef<string | null>(null);
  const markSuggestionBaseline = () => {
    const sess = aiSessions.find((s) => s.id === studySessionId);
    const last = sess ? [...sess.messages].reverse().find((m) => m.role === 'assistant') : null;
    lastScannedMsgId.current = last?.id ?? null;
  };
  useEffect(() => {
    if (!pendingSuggestion) return;
    const sess = aiSessions.find((s) => s.id === studySessionId);
    if (!sess || sess.isStreaming) return;
    const lastAssistant = [...sess.messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;
    if (lastScannedMsgId.current === lastAssistant.id) return;
    lastScannedMsgId.current = lastAssistant.id;
    // research 分支自动写盘、plan 分支填建议卡片；异步动作失败不阻塞 UI。
    consumeSuggestion(lastAssistant.content).catch(() => {});
  }, [aiSessions, studySessionId, pendingSuggestion, consumeSuggestion]);

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
    // 勾选完成当前会话单元 → 自动推进到下一未完成单元（学习闭环的"计划推进"）。
    if (unit.done && activeUnitOrder === unit.order) {
      const next = [...units].filter((u) => !u.done).sort((a, b) => a.order - b.order)[0];
      setActiveUnit(next ? next.order : null);
    }
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

  // ── AI 动作入口（research 自动写盘 `## 资料`；plan 走建议卡片；feynman/selftest/sq3r 直编+diff）──
  /** 第一步：开始 grill——AI 一次问一个问题，根据主题现场生成（问题+选项都由大模型决定）。 */
  const runGrill = () => {
    if (!active || !isAiAvailable()) return;
    markSuggestionBaseline();
    beginSuggestion('grill', active.slug);
    openStudyAiAction(
      active.path,
      buildStudyInstruction('grill', { topicName: active.parsed.frontmatter.title ?? active.slug, topicPath: active.path }),
      { openFile: false },
    );
  };
  /** grill 续轮：把用户对上一问的选择发给 agent，换取下一问或 done。 */
  const runGrillTurn = (answer: string | string[]) => {
    if (!active || !isAiAvailable()) return;
    // 记录本轮问答（问题 → 答案），done 卡片按问题展示。
    if (grillQuestion) {
      addGrillHistory({ question: grillQuestion.question, answer });
    }
    markSuggestionBaseline();
    beginSuggestion('grill', active.slug);
    openStudyAiAction(
      active.path,
      buildStudyInstruction('grill', {
        topicName: active.parsed.frontmatter.title ?? active.slug,
        topicPath: active.path,
        userAnswer: answer,
      }),
      { openFile: false },
    );
  };
  /** grill done 后用户选择继续追问：让 AI 基于已有对话再问几轮。 */
  const continueGrill = () => {
    if (!active || !isAiAvailable()) return;
    // 保留 done 内容（总结 + 按钮）与轮次/历史：等待下一问期间整体置灰 + 居中 Thinking，
    // 和 Next 行为一致。下一问到达时 consumeSuggestion 会清掉 grillDone。
    markSuggestionBaseline();
    beginSuggestion('grill', active.slug);
    openStudyAiAction(
      active.path,
      buildStudyInstruction('grill', {
        topicName: active.parsed.frontmatter.title ?? active.slug,
        topicPath: active.path,
        continueGrill: true,
      }),
      { openFile: false },
    );
  };
  /** 关闭 grill 弹窗：清空 grill 状态并撤销 in-flight 的 pending（避免卡片因 pendingSuggestion 残留而关不掉）。 */
  const cancelGrill = () => {
    clearSuggestions();
  };
  /** 跳过剩余问题：基于对话中已确认的信息直接开始找资料。 */
  const skipGrill = () => {
    if (!active || !isAiAvailable()) return;
    clearGrill();
    markSuggestionBaseline();
    beginSuggestion('research', active.slug);
    openStudyAiAction(
      active.path,
      buildStudyInstruction('research', {
        topicName: active.parsed.frontmatter.title ?? active.slug,
        topicPath: active.path,
        grillSummary: '', // 空串 → 指令不含总结行；agent 靠 resume 上下文记得对话
      }),
      { openFile: false },
    );
  };
  /** grill done：AI 确定学习目标总结 → 自动执行 research。 */
  const runResearchFromGrill = (summary: string) => {
    if (!active || !isAiAvailable()) return;
    clearGrill();
    markSuggestionBaseline();
    beginSuggestion('research', active.slug);
    openStudyAiAction(
      active.path,
      buildStudyInstruction('research', {
        topicName: active.parsed.frontmatter.title ?? active.slug,
        topicPath: active.path,
        grillSummary: summary,
      }),
      { openFile: false },
    );
  };


  const runPlanFromSelected = (selected: StudyMaterial[]) => {
    if (!active || !isAiAvailable()) return;
    markSuggestionBaseline();
    beginSuggestion('plan', active.slug);
    openStudyAiAction(
      active.path,
      buildStudyInstruction('plan', {
        topicName: active.parsed.frontmatter.title ?? active.slug,
        topicPath: active.path,
        selectedMaterials: selected,
      }),
      { openFile: false },
    );
  };

  // SQ3R：先查子文档 `__study__/<slug>/sq3r-<materialSlug>.md` 是否已有该资料的预读内容——
  // 命中直接展示（不调 AI）；未命中 → markSuggestionBaseline + beginSuggestion('sq3r', ...) +
  // openStudyAiAction，consumeSuggestion 收到产出后填 sq3rOutput，弹窗展示。
  const runSq3r = async (m: StudyMaterial) => {
    if (!active || !isAiAvailable()) return;
    const cached = await findSq3rSubdoc(active.slug, m.title);
    if (cached) {
      setSq3rOutput({ materialId: m.id, materialTitle: m.title, content: cached });
      return;
    }
    markSuggestionBaseline();
    beginSuggestion('sq3r', active.slug, { materialId: m.id, materialTitle: m.title });
    openStudyAiAction(
      active.path,
      buildStudyInstruction('sq3r', {
        topicName: active.parsed.frontmatter.title ?? active.slug,
        topicPath: active.path,
        materialTitle: m.title,
        materialUrl: m.url,
      }),
      { openFile: false },
    );
  };

  const runAtoms = () => {
    if (!active || !isAiAvailable()) return;
    markSuggestionBaseline();
    beginSuggestion('atoms', active.slug);
    openStudyAiAction(
      active.path,
      buildStudyInstruction('atoms', { topicName: active.parsed.frontmatter.title ?? active.slug, topicPath: active.path }),
      { openFile: false },
    );
  };
  const runQuiz = () => {
    if (!active || !isAiAvailable()) return;
    markSuggestionBaseline();
    beginSuggestion('quiz', active.slug);
    openStudyAiAction(
      active.path,
      buildStudyInstruction('quiz', { topicName: active.parsed.frontmatter.title ?? active.slug, topicPath: active.path }),
      { openFile: false },
    );
  };

  // ── 单元学习会话：进入/退出/完成（勾选 + 推进下一未完成单元）──
  const openNotes = () => {
    if (!active) return;
    editorIoService.openFile(active.path, active.path.split('/').pop() ?? active.path);
  };
  const completeActiveUnit = async (unit: StudyUnit) => {
    if (!active) return;
    const units = active.parsed.units.map((u) =>
      u.id === unit.id ? { ...u, done: true, prog: 100 } : u,
    );
    await saveTopicEdits(active.slug, { units });
    const next = [...units].filter((u) => !u.done).sort((a, b) => a.order - b.order)[0];
    setActiveUnit(next ? next.order : null);
  };

  // ── 检测区：增/删/自评（答错自动生成复习原子，回流间隔重复）──
  const addQuiz = async (q: QuizItem) => {
    if (!active) return;
    await saveTopicEdits(active.slug, { quizItems: [...active.parsed.quizItems, q] });
  };
  const deleteQuiz = async (id: string) => {
    if (!active) return;
    const quizItems = active.parsed.quizItems.filter((x) => x.id !== id);
    await saveTopicEdits(active.slug, { quizItems });
  };
  const rateQuiz = async (id: string, correct: boolean) => {
    if (!active) return;
    await rateQuizItem(active.slug, id, correct);
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
                <button className={view === 'topic' ? 'active' : ''} onClick={() => setView('topic')} aria-pressed={view === 'topic'}>{t('study:topbar.topicView')}</button>
                <button className={view === 'today' ? 'active' : ''} onClick={() => setView('today')} aria-pressed={view === 'today'}>{t('study:topbar.todayView')}</button>
              </div>
              {active && view === 'topic' && planProgress && planProgress.total > 0 && (
                <span className="sw-study-topbar-progress" title={t('study:topbar.progressTitle')}>
                  <span className="sw-study-topbar-progress-pct">{planProgress.percent}%</span>
                  <span className="sw-study-count">{planProgress.done}/{planProgress.total}</span>
                </span>
              )}
            </div>
            {pendingDiffCount > 0 && (
              <button className="sw-diff-banner" onClick={goReviewDiff} title={t('study:topbar.diffBannerTitle')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
                {t('study:topbar.diffBanner', { count: pendingDiffCount })}
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
                materials={active.parsed.materials}
                onAdd={addMaterial}
                onEdit={editMaterial}
                onDelete={deleteMaterial}
                onResearch={runGrill}
                onSq3r={runSq3r}
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
                activeUnitOrder={activeUnitOrder}
                onStartUnit={setActiveUnit}
                onExitUnit={() => setActiveUnit(null)}
                onOpenNotes={openNotes}
                onGenerateQuiz={runQuiz}
                onCompleteUnit={completeActiveUnit}
              />
              <StudyNotesSection slug={active.slug} path={active.path} topicName={active.parsed.frontmatter.title ?? active.slug} parsed={active.parsed} onGenerateAtoms={runAtoms} />
              <StudyReviewSection slug={active.slug} path={active.path} topicName={active.parsed.frontmatter.title ?? active.slug} parsed={active.parsed} onRate={rateAtom} onAdd={addReviewAtom} />
              <StudyQuizSection
                quizItems={active.parsed.quizItems}
                onAdd={addQuiz}
                onDelete={deleteQuiz}
                onRate={rateQuiz}
                onGenerateQuiz={runQuiz}
              />
            </div>
          ) : (
            <div className="sw-study-placeholder">
              <h2 className="sw-topbar-title">{t('study:title')}</h2>
              <p className="sw-empty-hint">{t('study:empty')}</p>
            </div>
          )}
        </div>
      </main>
      {removingSlug && <StudyDeletingOverlay />}
      {/* 首轮（尚无问题）不在浮层显示，由资料栏置灰 + 居中加载；有问题/总结才弹卡。
          key 随 question/轮次变化 → 强制重置卡片内部状态（选中/自定义），
          避免上一题的选项残留导致 Next 不置灰。 */}
      {(grillQuestion || grillDone != null) && (
        <StudyGrillCard
          key={`${grillQuestion?.id ?? 'grill-done'}-${grillRound}`}
          question={grillQuestion}
          round={grillRound}
          waiting={grillPending}
          doneSummary={grillDone}
          history={grillHistory}
          onAnswer={(answer) => runGrillTurn(answer)}
          onSkip={skipGrill}
          onCancel={cancelGrill}
          onResearch={() => grillDone != null && runResearchFromGrill(grillDone)}
          onContinue={continueGrill}
        />
      )}
    </div>
  );
}
