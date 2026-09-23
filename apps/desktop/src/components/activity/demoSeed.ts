/**
 * Dev-only demo data (see ActivityPage「演示数据」button): builds ~45
 * deterministic events and pushes them through the real ingest pipeline
 * (`activity_push_events`), so entity resolution / relations / task
 * materialization all apply and the whole activity UI lights up.
 * Deterministic ids (demo-001…) make repeat clicks dedup (INSERT OR IGNORE)
 * instead of duplicating.
 */

import { invoke } from '@/services/tauriInvoke';

const COLLECTOR = 'demo-mock';
const DECLARED_TYPES = ['commit', 'meeting', 'message', 'doc_edit', 'task', 'deploy'];
const DAY = 86400000;

const ME = { type: 'person', identityKey: 'me', displayName: '我' };

interface DemoEvent {
  id: string;
  type: string;
  source: string;
  occurredAt: number;
  title?: string;
  summary?: string;
  url?: string;
  payload?: Record<string, unknown>;
  actor?: typeof ME;
  entities?: { type: string; identityKey: string; displayName?: string; relation: string }[];
}

/** Epoch ms at `dayOffset` days from today, fixed clock time. */
function at(dayOffset: number, h: number, m: number): number {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

let seq = 0;
const nid = () => `demo-${String(++seq).padStart(3, '0')}`;

function commit(dayOffset: number, h: number, m: number, title: string): DemoEvent {
  const repo = seq % 2 === 0 ? 'folyn' : 'vault-sync';
  const sha = `a${(seq + 10).toString(16)}b2c3d`;
  return {
    id: nid(),
    type: 'commit',
    source: COLLECTOR,
    occurredAt: at(dayOffset, h, m),
    title,
    summary: '分支 master，改动若干文件',
    url: `https://github.com/linyimin/folyn/commit/${sha}`,
    payload: { sha, branch: 'master', additions: 12 + seq, deletions: seq },
    actor: ME,
    entities: [
      { type: 'repository', identityKey: repo, displayName: repo, relation: repo === 'folyn' ? '提交于' : '提交' },
    ],
  };
}

function meeting(dayOffset: number, h: number, minutes: number, key: string, name: string, title: string): DemoEvent {
  return {
    id: nid(),
    type: 'meeting',
    source: COLLECTOR,
    occurredAt: at(dayOffset, h, 0),
    title,
    summary: `${minutes} 分钟 · 3 位参与人`,
    payload: { minutes, attendees: ['我', '张三', '李四'] },
    actor: ME,
    entities: [{ type: 'meeting', identityKey: key, displayName: name, relation: '参与' }],
  };
}

function message(dayOffset: number, h: number, m: number, channel: string, count: number, withZhangsan: boolean): DemoEvent {
  return {
    id: nid(),
    type: 'message',
    source: COLLECTOR,
    occurredAt: at(dayOffset, h, m),
    title: `${channel} · ${count} 条消息`,
    summary: `在 ${channel} 的讨论`,
    payload: { channel, messageCount: count },
    actor: ME,
    entities: withZhangsan
      ? [{ type: 'person', identityKey: 'zhangsan', displayName: '张三', relation: '沟通' }]
      : undefined,
  };
}

function docEdit(dayOffset: number, h: number, m: number, key: string, name: string): DemoEvent {
  return {
    id: nid(),
    type: 'doc_edit',
    source: COLLECTOR,
    occurredAt: at(dayOffset, h, m),
    title: `更新 ${name}`,
    summary: '补充设计章节',
    actor: ME,
    entities: [{ type: 'document', identityKey: key, displayName: name, relation: '编辑' }],
  };
}

function task(
  dayOffset: number,
  h: number,
  m: number,
  key: string,
  name: string,
  status: string,
  startDate: number,
  dueDate: number,
  progressNote: string,
): DemoEvent {
  return {
    id: nid(),
    type: 'task',
    source: COLLECTOR,
    occurredAt: at(dayOffset, h, m),
    title: `${name} · 状态 → ${status === 'done' ? '已完成' : status === 'in_progress' ? '进行中' : status}`,
    summary: progressNote,
    payload: { taskId: key, status, startDate, dueDate, progressNote },
    actor: ME,
    entities: [{ type: 'task', identityKey: key, displayName: name, relation: '更新' }],
  };
}

function deploy(dayOffset: number, h: number, m: number, env: string): DemoEvent {
  return {
    id: nid(),
    type: 'deploy', // unregistered type → gray fallback rendering (design §3.2)
    source: COLLECTOR,
    occurredAt: at(dayOffset, h, m),
    title: `部署至 ${env}`,
    summary: '发布流程执行完成',
    payload: { env },
    actor: ME,
  };
}

function buildDemoEvents(): DemoEvent[] {
  const now = Date.now();
  const events: DemoEvent[] = [
    // ── commits (15) ──
    commit(0, 9, 12, 'fix(desktop): 修复日历区间标签'),
    commit(0, 10, 40, 'feat(activity): 指标卡 pin 状态持久化'),
    commit(0, 14, 5, 'refactor(graph): 面包屑超 3 级折叠'),
    commit(0, 16, 30, 'chore(deps): 升级 zustand'),
    commit(-1, 11, 20, 'feat(activity): 实体动态浏览器布局'),
    commit(-1, 17, 2, 'fix(activity): 时区导致的日报偏移'),
    commit(-3, 10, 15, 'feat(activity): 写入管道实体解析'),
    commit(-3, 15, 44, 'test(activity): ingest 去重用例'),
    commit(-5, 9, 50, 'feat(activity): pushEvents API'),
    commit(-5, 14, 18, 'docs: 活动采集设计文档'),
    commit(-10, 11, 5, 'feat(activity): schema 骨架'),
    commit(-10, 16, 22, 'fix(db): 索引缺失导致查询变慢'),
    commit(-10, 19, 8, 'chore: 清理原型遗留代码'),
    commit(-18, 10, 30, 'feat: 活动页初始路由'),
    commit(-18, 15, 12, 'wip: 采集器贡献点草稿'),

    // ── meetings (6) ──
    meeting(0, 10, 30, 'standup', '每日站会', '每日站会'),
    meeting(0, 14, 90, 'arch-review', '架构评审', '架构评审：collectors 贡献点'),
    meeting(-1, 11, 60, 'sync', '需求同步会', '需求同步会'),
    meeting(-3, 15, 45, 'weekly', '周会', '团队周会'),
    meeting(-5, 10, 120, 'design', '设计评审', '实体关系设计评审'),
    meeting(-10, 14, 30, 'standup', '每日站会', '每日站会（远程）'),

    // ── messages (5) ──
    message(0, 9, 40, '#folyn-dev', 3, true),
    message(0, 13, 36, '#folyn-dev', 5, false),
    message(-1, 10, 2, '#activity', 2, true),
    message(-3, 16, 11, '#folyn-dev', 4, true),
    message(-5, 11, 26, '#activity', 1, false),

    // ── doc_edits (8) ──
    docEdit(0, 11, 15, 'activity-design', '活动采集设计.md'),
    docEdit(0, 16, 10, 'activity-design', '活动采集设计.md'),
    docEdit(-1, 15, 32, 'weekly-report', '周报.md'),
    docEdit(-3, 10, 55, 'activity-design', '活动采集设计.md'),
    docEdit(-5, 14, 44, 'ingest-notes', '写入管道笔记.md'),
    docEdit(-5, 17, 20, 'activity-design', '活动采集设计.md'),
    docEdit(-10, 13, 9, 'roadmap', '路线图.md'),
    docEdit(-18, 11, 42, 'proto-notes', '原型交互笔记.md'),

    // ── tasks (9) — payload materializes into entity metadata (OngoingTasks) ──
    // in_progress, 6 天前开始、4 天后到期（day 7/10）
    task(-6, 10, 0, 'sdk', '活动采集器 SDK 开发', 'in_progress', now - 6 * DAY, now + 4 * DAY, '接口定义完成，进入联调'),
    task(0, 9, 30, 'sdk', '活动采集器 SDK 开发', 'in_progress', now - 6 * DAY, now + 4 * DAY, '写入管道联调中'),
    // in_progress, 10 天前开始、2 天前到期（已逾期，不在进行中窗口内）
    task(-10, 11, 0, 'registry', '采集器注册表冲突提示', 'in_progress', now - 10 * DAY, now - 2 * DAY, '等待设计确认'),
    // done 今天完成
    task(-3, 10, 0, 'pin', '指标卡 pin 交互', 'in_progress', now - 3 * DAY, now, '布局调整中'),
    task(0, 15, 0, 'pin', '指标卡 pin 交互', 'done', now - 3 * DAY, now, '已完成，交互与原型一致'),
    // in_progress, 20 天前开始、5 天后到期（day 21/25）
    task(-20, 10, 30, 'graph', '实体关系浏览器', 'in_progress', now - 20 * DAY, now + 5 * DAY, '放射布局已定，聚合交互开发中'),
    // done 的历史任务（时间线里可见）
    task(-5, 16, 0, 'schema', 'ActivityEvent Schema', 'done', now - 8 * DAY, now - 5 * DAY, '已定稿'),
    task(-12, 14, 0, 'cursor', '游标推进机制', 'done', now - 15 * DAY, now - 12 * DAY, '已上线'),
    task(-18, 9, 0, 'route', '活动页路由', 'done', now - 22 * DAY, now - 18 * DAY, '已完成'),

    // ── deploys (2) — unregistered type, gray fallback ──
    deploy(0, 17, 5, 'staging'),
    deploy(-3, 18, 30, 'production'),
  ];
  return events;
}

export async function seedDemoActivity(vaultRoot: string): Promise<void> {
  await invoke('activity_push_events', {
    vaultRoot,
    collectorId: COLLECTOR,
    declaredTypes: DECLARED_TYPES,
    events: buildDemoEvents(),
  });
}
