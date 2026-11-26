// windowSessionService — 多窗口研究任务的会话模型（spec 6.3–6.5）。
//
// 一个「会话」= 一组标签页 + 阅读现场 + 窗口几何，由恰好一个宿主窗口持有：
//  - 主窗口（label "main"）启动时「接管」最近活跃的会话（spec 6.5 启动时
//    优先恢复最近活跃窗口），其余会话标记为已关闭、留在最近窗口列表里
//    按需恢复（不自动恢复所有窗口）。
//  - 研究窗口（label "research-<id>"，路由 `#/research/<id>`）绑定创建时
//    指定的会话，拥有独立的 editorStore/persistence 作用域。
//
// 存储布局（storageClient，~/.folyn/storage/）：
//  - `editor:windowSessions` — 会话索引 { sessions: Record<id, record> }。
//    每个窗口只改写自己的记录（read-modify-write），跨窗口竞态最坏情况
//    是另一条记录的时间戳短暂回退，下次活动写入自愈。
//  - `editor:session:<id>:tabs:<vaultId>` / `editor:session:<id>:external`
//    — 会话作用域的标签页持久化（由 editorPersistence 按 getSessionId()
//    生成，本服务不直接读写）。
//
// 窗口创建走 Rust 命令 `create_research_window`（WebviewWindowBuilder，
// 路由 `/#/research/<id>`，label `research-<id>` 去重复用 → focus）。
//
// 存活真相：磁盘索引的 open 标志可能因重载/接管竞态失真，但 Rust 窗口
// 列表不会——`list_research_windows` 返回的存活会话集合用于：接管跳过、
// 最近列表过滤、恢复去重（Rust 侧同 label → focus）。

import { storageClient } from '@/utils/storageClient';
import { debounce } from '@/utils/debounce';
import { useEditorStore } from '@/store/editorStore';
import { isTauri } from '@/utils/platform';

export interface SessionGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowSessionRecord {
  id: string;
  kind: 'main' | 'research';
  /** 展示名（「研究 1」…），持久化在记录里。 */
  name: string;
  createdAt: number;
  /** 最后活动时间（ms epoch）——标签切换/窗口聚焦时更新。 */
  lastActiveAt: number;
  /** 当前是否被某个窗口持有（recent 列表只显示 closed）。 */
  open: boolean;
  /** 关闭时间（open=true 时为 null）。 */
  closedAt: number | null;
  vaultId: string | null;
  tabCount: number;
  /** 最近活动文档名/路径（展示识别信息）。 */
  lastDocName: string | null;
  lastDocPath: string | null;
  /** 活动标签的章节上下文（readingHeading.text）。 */
  lastHeading: string | null;
  /** 窗口几何（logical px），恢复时传给 Rust；全屏/最大化时置 null。 */
  geometry: SessionGeometry | null;
}

interface SessionIndex {
  sessions: Record<string, WindowSessionRecord>;
}

const INDEX_KEY = 'editor:windowSessions';

// ── 本窗口绑定状态（模块级，绑定一次） ────────────────────────────────
let boundSessionId: string | null = null;
let activityStop: (() => void) | null = null;

/** 同步读取本窗口会话 id。未绑定时返回 'main'（持久化键的安全默认值）。 */
export function getSessionId(): string {
  return boundSessionId ?? 'main';
}

/** 本窗口是否为研究窗口（路由 #/research/<id>）。 */
export function isResearchWindow(): boolean {
  if (typeof window === 'undefined') return false;
  const loc = window.location.hash || window.location.href || '';
  return loc.indexOf('#/research/') !== -1;
}

/** 本窗口是否承担主窗口职责（pet/tray/voice/deep-link/广播宿主）。 */
export function isMainWindow(): boolean {
  return !isResearchWindow();
}

export function getOwnWindowKind(): 'main' | 'research' {
  return isResearchWindow() ? 'research' : 'main';
}

function newSessionId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `r-${rand}`;
}

async function readIndexFresh(): Promise<SessionIndex> {
  const idx = await storageClient.getFresh<SessionIndex>(INDEX_KEY);
  return idx && typeof idx === 'object' && idx.sessions ? idx : { sessions: {} };
}

async function writeIndex(index: SessionIndex): Promise<void> {
  await storageClient.set(INDEX_KEY, index);
}

/** 读取全部会话记录（fresh——用于跨窗口可见的最近窗口列表）。 */
export async function listSessions(): Promise<WindowSessionRecord[]> {
  const idx = await readIndexFresh();
  return Object.values(idx.sessions).sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

/** 已关闭的会话（最近窗口列表的数据源）。存活研究窗口持有的会话
 *  即使磁盘标志失真（重载竞态）也不列出——窗口列表是唯一真相。 */
export async function listClosedSessions(): Promise<WindowSessionRecord[]> {
  const [all, live] = await Promise.all([listSessions(), listLiveResearchSessionIds()]);
  return all.filter((s) => !s.open && !live.has(s.id));
}

/** 只改写「自己那条」记录的 read-modify-write。 */
async function updateOwnRecord(patch: Partial<WindowSessionRecord>): Promise<void> {
  if (!boundSessionId) return;
  const idx = await readIndexFresh();
  const prev = idx.sessions[boundSessionId];
  if (!prev) return; // 记录被清除（用户主动清理）→ 停止追加，不重建
  idx.sessions[boundSessionId] = { ...prev, ...patch, id: boundSessionId };
  await writeIndex(idx);
}

function defaultRecord(id: string, kind: 'main' | 'research', name: string): WindowSessionRecord {
  return {
    id,
    kind,
    name,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    open: true,
    closedAt: null,
    vaultId: null,
    tabCount: 0,
    lastDocName: null,
    lastDocPath: null,
    lastHeading: null,
    geometry: null,
  };
}

/** 研究窗口展示名的自增序号：现有「研究 N」最大值 + 1。 */
function nextResearchName(records: WindowSessionRecord[]): string {
  let max = 0;
  for (const r of records) {
    const m = /^研究\s+(\d+)$/.exec(r.name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `研究 ${max + 1}`;
}

// ── 窗口绑定（启动时调用一次，早于 restoreOpenTabs） ──────────────────
export interface BoundSession {
  sessionId: string;
  kind: 'main' | 'research';
  /** 主窗口启动时接管的会话记录（可能为 null——索引读取失败时按 fresh 处理）。 */
  claimed: WindowSessionRecord | null;
}

/** 主窗口在本窗口生命周期内绑定的会话 id（sessionStorage：窗口重载保留、
 *  销毁即清空——正好是「本窗口身份」的存续范围）。 */
const MAIN_SESSION_STORAGE_KEY = 'folyn:mainSession';

/** 存活研究窗口的会话 id 集合（Rust 窗口列表是唯一真相）。
 *  磁盘索引的 open 标志会在 dev 重载/接管竞态下失真；窗口本身不会。 */
async function listLiveResearchSessionIds(): Promise<Set<string>> {
  if (!isTauri() || typeof window === 'undefined') return new Set();
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const labels = await invoke<string[]>('list_research_windows');
    if (!Array.isArray(labels)) return new Set();
    return new Set(labels.map((l) => l.slice('research-'.length)));
  } catch {
    return new Set();
  }
}

/**
 * 绑定本窗口的会话：
 *  - 研究窗口：从 `#/research/<id>` 读会话 id；索引里没有记录（被清除
 *    过/损坏）就补建一条，保证「窗口存在 ⇒ 记录存在」。
 *  - 主窗口：
 *    · 重载（sessionStorage 里有上次绑定）→ 复绑原会话，跳过接管；
 *      否则 dev 重载/Cmd+R 会让主窗口重新抢占仍存活的研究窗口会话
 *      （最近列表出现存活窗口、恢复开出第二个窗口的根因）。
 *    · 冷启动 → 接管最近活跃的、没有存活宿主的会话（存活研究窗口
 *      持有的会话不可接管），其余无宿主会话标记关闭。没有索引
 *      （首启/升级前）→ 创建 `main` 会话；标签页数据由
 *      editorPersistence 的 legacy 兜底读取。
 */
export async function bindSession(): Promise<BoundSession> {
  // 记录本窗口的 Tauri label（label 决定 capabilities/事件路由；绑定
  // 只是顺带记录，失败不阻塞——jsdom/测试环境没有 Tauri API）。
  if (isResearchWindow()) {
    const hash = typeof window !== 'undefined' ? window.location.hash || '' : '';
    const m = /^#\/research\/([A-Za-z0-9_-]+)/.exec(hash);
    const sessionId = m?.[1] ?? newSessionId();
    const idx = await readIndexFresh();
    let record = idx.sessions[sessionId];
    if (!record) {
      record = defaultRecord(sessionId, 'research', nextResearchName(Object.values(idx.sessions)));
      idx.sessions[sessionId] = record;
      await writeIndex(idx);
    } else if (!record.open) {
      // 记录还在但标记为关闭（上次退出后没有启动接管流程）→ 复活。
      record = { ...record, open: true, closedAt: null, lastActiveAt: Date.now() };
      idx.sessions[sessionId] = record;
      await writeIndex(idx);
    }
    boundSessionId = sessionId;
    return { sessionId, kind: 'research', claimed: record };
  }

  // 主窗口。
  const idx = await readIndexFresh();
  const now = Date.now();
  let claimed: WindowSessionRecord;

  // ① 重载复绑：本窗口上次绑定的会话直接沿用（接管是冷启动行为）。
  const prevId =
    typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(MAIN_SESSION_STORAGE_KEY) : null;
  if (prevId && idx.sessions[prevId]) {
    const prev = idx.sessions[prevId];
    claimed = { ...prev, open: true, closedAt: null, lastActiveAt: now };
    idx.sessions[prevId] = claimed;
    await writeIndex(idx);
    boundSessionId = prevId;
    return { sessionId: prevId, kind: 'main', claimed };
  }

  // ② 冷启动接管：只挑没有存活宿主的会话（存活研究窗口的会话不可抢）。
  const live = await listLiveResearchSessionIds();
  const all = Object.values(idx.sessions);
  const candidates = all
    .filter((r) => !live.has(r.id))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);

  if (candidates.length > 0) {
    claimed = candidates[0];
    // 互斥：其余无宿主会话标记关闭（存活宿主的会话保持不动）。
    for (const r of all) {
      if (r.id !== claimed.id && !live.has(r.id) && (r.open || r.closedAt === null)) {
        idx.sessions[r.id] = { ...r, open: false, closedAt: now };
      }
    }
    claimed = { ...claimed, open: true, closedAt: null, lastActiveAt: now };
    idx.sessions[claimed.id] = claimed;
  } else if (all.length > 0) {
    // 所有会话都有存活研究窗口宿主：主窗口不抢，新开 main 会话。
    claimed = defaultRecord('main', 'main', '主窗口');
    idx.sessions[claimed.id] = claimed;
  } else {
    claimed = defaultRecord('main', 'main', '主窗口');
    idx.sessions[claimed.id] = claimed;
  }
  await writeIndex(idx);
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem(MAIN_SESSION_STORAGE_KEY, claimed.id);
  }
  boundSessionId = claimed.id;
  return { sessionId: claimed.id, kind: 'main', claimed };
}

// ── 活动追踪（tabCount / lastDoc / lastActiveAt 的写源） ─────────────
interface ActivitySnapshot {
  tabCount: number;
  lastDocName: string | null;
  lastDocPath: string | null;
  lastHeading: string | null;
  vaultId: string | null;
  lastActiveAt: number;
}

function snapshotFromEditorStore(): ActivitySnapshot {
  const { tabs, activeTabId } = useEditorStore.getState();
  const active = tabs.find((t) => t.id === activeTabId) ?? null;
  return {
    tabCount: tabs.length,
    lastDocName: active?.name ?? null,
    lastDocPath: active?.path ?? null,
    lastHeading: active?.readingHeading?.text ?? null,
    vaultId: null, // 由 markVaultKnown 在 initVault 之后单独补写
    lastActiveAt: Date.now(),
  };
}

const writeActivityDebounced = debounce((snap: ActivitySnapshot) => {
  void updateOwnRecord(snap);
}, 1500);

/** 启动本窗口的会话活动追踪：标签集合/活动标签/章节变化 + 窗口聚焦。 */
export function startSessionActivityTracking(): () => void {
  if (activityStop) return activityStop;
  const stops: Array<() => void> = [];

  // editorStore 订阅：tabs 数组引用变化（开/关/换活动标签/章节写入都会换引用）。
  let lastSig = '';
  const unsub = useEditorStore.subscribe((state) => {
    const active = state.tabs.find((t) => t.id === state.activeTabId) ?? null;
    const sig = `${state.tabs.length}|${state.activeTabId ?? ''}|${active?.name ?? ''}|${active?.readingHeading?.text ?? ''}`;
    if (sig === lastSig) return;
    lastSig = sig;
    writeActivityDebounced(snapshotFromEditorStore());
  });
  stops.push(unsub);

  // 窗口聚焦 → lastActiveAt（主窗口「接管最近活跃」的依据）。
  if (isTauri() && typeof window !== 'undefined') {
    const onFocus = () => writeActivityDebounced(snapshotFromEditorStore());
    window.addEventListener('focus', onFocus);
    stops.push(() => window.removeEventListener('focus', onFocus));
  }

  activityStop = () => {
    writeActivityDebounced.cancel();
    for (const s of stops) s();
    activityStop = null;
  };
  return activityStop;
}

/** initVault 之后补写会话的 vaultId（最近窗口列表识别信息）。 */
export async function markVaultKnown(vaultId: string): Promise<void> {
  await updateOwnRecord({ vaultId });
}

// ── 窗口几何 ─────────────────────────────────────────────────────────
/** 关闭前采集窗口几何（logical px）。最大化/全屏返回 null（恢复用默认尺寸）。 */
export async function captureGeometry(): Promise<SessionGeometry | null> {
  if (!isTauri()) return null;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    const w = getCurrentWindow();
    const [pos, size, scaleFactor, maximized, fullscreen] = await Promise.all([
      w.outerPosition(),
      w.outerSize(),
      w.scaleFactor(),
      w.isMaximized(),
      w.isFullscreen(),
    ]);
    if (maximized || fullscreen) return null;
    return {
      x: pos.x / scaleFactor,
      y: pos.y / scaleFactor,
      width: size.width / scaleFactor,
      height: size.height / scaleFactor,
    };
  } catch {
    return null;
  }
}

// ── 关闭（持久化最终记录 + 标记 closed） ─────────────────────────────
/** 窗口真关闭前调用：最终活动快照 + 几何 + closed 标记（flush，不 debounce）。 */
export async function closeOwnSessionRecord(): Promise<void> {
  if (!boundSessionId) return;
  writeActivityDebounced.cancel();
  const geometry = await captureGeometry();
  const snap = snapshotFromEditorStore();
  await updateOwnRecord({
    ...snap,
    geometry,
    open: false,
    closedAt: Date.now(),
  });
}

// ── 创建 / 恢复研究窗口 ─────────────────────────────────────────────
export interface CreateResearchWindowOptions {
  /** 恢复已有会话（最近窗口列表）；缺省创建全新空会话。 */
  sessionId?: string;
  geometry?: SessionGeometry | null;
}

/** 新建（或恢复）一个研究窗口。返回会话 id。 */
export async function createResearchWindow(options: CreateResearchWindowOptions = {}): Promise<string> {
  let sessionId = options.sessionId ?? null;

  if (!sessionId) {
    // 全新会话：分配 id + 名称，写入索引（open=true）。
    sessionId = newSessionId();
    const idx = await readIndexFresh();
    const record = defaultRecord(sessionId, 'research', nextResearchName(Object.values(idx.sessions)));
    idx.sessions[sessionId] = record;
    await writeIndex(idx);
  }

  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const record = (await readIndexFresh()).sessions[sessionId];
    await invoke('create_research_window', {
      sessionId,
      title: record?.name ?? 'Folyn',
      geometry: options.geometry ?? record?.geometry ?? null,
    });
  }
  return sessionId;
}

/**
 * 恢复一个关闭的研究窗口会话（spec 6.4 恢复入口）。
 *
 * 会话互斥：已 open 的会话不会出现在最近列表里（listClosedSessions
 * 过滤），但 TOCTOU 下仍可能点到刚被其它窗口恢复的会话——重复
 * create_research_window 在 Rust 侧变为 focus 既有窗口，安全。
 * 恢复后记录翻回 open（closedAt 清空），窗口关闭时再次标记。
 */
export async function restoreSession(sessionId: string): Promise<void> {
  if (!sessionId || sessionId === 'main') return;
  const idx = await readIndexFresh();
  const record = idx.sessions[sessionId];
  if (!record) return;
  idx.sessions[sessionId] = { ...record, open: true, closedAt: null };
  await writeIndex(idx);
  await createResearchWindow({ sessionId });
}

// ── 清理恢复记录（spec 6.4：不删除 Vault 文件，只清索引记录） ────────
export async function clearSessionRecord(sessionId: string): Promise<void> {
  const idx = await readIndexFresh();
  if (!idx.sessions[sessionId]) return;
  delete idx.sessions[sessionId];
  await writeIndex(idx);
  // 会话自己的标签页持久化键一并清掉（external 键可推导；vault 键
  // 无法枚举 vaultId，遗留无害——记录删除后不再可恢复）。
  await storageClient.remove(`editor:session:${sessionId}:external`);
}

export async function clearAllClosedSessions(): Promise<void> {
  const idx = await readIndexFresh();
  const removed: string[] = [];
  for (const [id, r] of Object.entries(idx.sessions)) {
    if (!r.open) removed.push(id);
  }
  if (removed.length === 0) return;
  const next: SessionIndex = { sessions: {} };
  for (const [id, r] of Object.entries(idx.sessions)) {
    if (r.open) next.sessions[id] = r;
  }
  await writeIndex(next);
  await Promise.all(removed.map((id) => storageClient.remove(`editor:session:${id}:external`)));
}

// ── 测试缝 ──────────────────────────────────────────────────────────
/** vitest：重置模块级绑定/追踪状态（连同主窗口身份标记）。 */
export function __clearSessionState(): void {
  boundSessionId = null;
  activityStop?.();
  activityStop = null;
  writeActivityDebounced.cancel();
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(MAIN_SESSION_STORAGE_KEY);
  }
}

/** vitest：直接查看模块绑定（断言用）。 */
export function __getBoundSessionId(): string | null {
  return boundSessionId;
}
