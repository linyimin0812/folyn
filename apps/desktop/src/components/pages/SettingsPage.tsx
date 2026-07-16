import { useState, useEffect, useRef, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useNavStore, type SettingsTab } from '@/store/navStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useEditorPrefsStore } from '@/store/editorPrefsStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { usePrefsStore } from '@/store/prefsStore';
import { usePetStore, type NotificationForm } from '@/store/petStore';
import { useSkillStore } from '@/store/skillStore';
import { builtinSkills } from '@/services/skillDefaults';
import type { SkillOutputFormat, SkillCapability } from '@/types/skill';
import { isTauri } from '@/utils/platform';
import { listAdapters } from '@quill/cli-adapter';
import { testChatConnection } from '@/services/rigChat';
import { PluginsSettings } from '@/components/settings/PluginsSettings';
import { VoiceSettings } from '@/components/settings/VoiceSettings';

/** Map keyboard event key to display symbol */
function keyToSymbol(key: string): string {
  const map: Record<string, string> = {
    Meta: '⌘', Control: 'Ctrl', Alt: '⌥', Shift: 'Shift',
  };
  if (map[key]) return map[key];
  if (key.length === 1) return key.toUpperCase();
  return key;
}

function ShortcutEditor({ shortcutId, currentKeys }: { shortcutId: string; currentKeys: string[] }) {
  const [recording, setRecording] = useState(false);
  // True when recording started but no keydown was captured within the
  // timeout window. App menu accelerators (e.g. Cmd+Shift+P → "Desktop Pet
  // Mode") and macOS system shortcuts (Cmd+Q, Cmd+H, Cmd+M, Cmd+W) are
  // consumed at the OS/menu layer BEFORE the webview's keydown fires — so
  // the ShortcutEditor's `handleKeyDown` listener never sees them, recording
  // stays open, and the user sees "按下快捷键…" forever with no feedback.
  // This flag flips on timeout to surface "the combo you pressed is occupied".
  const [conflictHint, setConflictHint] = useState(false);
  const updateShortcut = usePrefsStore((s) => s.updateShortcut);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();

    // Ignore lone modifier keys
    if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return;

    const keys: string[] = [];
    if (event.metaKey) keys.push('⌘');
    if (event.ctrlKey) keys.push('Ctrl');
    if (event.altKey) keys.push('⌥');
    if (event.shiftKey) keys.push('Shift');
    keys.push(keyToSymbol(event.key));

    updateShortcut(shortcutId, keys);
    setConflictHint(false);
    setRecording(false);

    // Global shortcuts (currently only `togglePetPanel`) are registered with
    // the OS via the `pet_panel_set_shortcut` Rust command. Re-register on
    // every rebind so the new combo takes effect system-wide immediately —
    // the command unregisters the old accelerator before registering the new
    // one. In-editor keybindings (everything else) need no Rust-side action;
    // they're consumed by EditorView's keymap. Non-Tauri/test envs skip this.
    if (shortcutId === 'togglePetPanel' && isTauri()) {
      void (async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core');
          const { keysToAccelerator } = await import('@/utils/shortcutAccelerator');
          const accelerator = keysToAccelerator(keys);
          await invoke('pet_panel_set_shortcut', { accelerator });
          console.info('[settings] global shortcut re-registered:', accelerator);
        } catch (err) {
          console.warn('[settings] failed to re-register global shortcut:', err);
        }
      })();
    }
  }, [shortcutId, updateShortcut]);

  useEffect(() => {
    if (!recording) return;
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [recording, handleKeyDown]);

  // Conflict-detection timeout: if no keydown is captured within 2.5s of
  // entering recording mode, flip `conflictHint` so the UI surfaces a message.
  // The keydown listener above never fires for combos consumed by the app
  // menu / macOS system (they're intercepted at the OS layer), so the only
  // signal we have is "nothing arrived". The timer is cancelled on unmount
  // or when recording exits (via capture or click-outside). 2.5s is long
  // enough that a slow user won't trip it, short enough to feel responsive.
  useEffect(() => {
    if (!recording) {
      setConflictHint(false);
      return;
    }
    setConflictHint(false);
    const id = window.setTimeout(() => setConflictHint(true), 2500);
    return () => window.clearTimeout(id);
  }, [recording]);

  // Close on click outside
  useEffect(() => {
    if (!recording) return;
    const handleClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setRecording(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [recording]);

  return (
    <div ref={containerRef} className="sk-keys flex items-center gap-[3px] cursor-pointer" onClick={() => setRecording(true)}>
      {recording ? (
        conflictHint ? (
          <span className="key bg-amber/10 border border-amber text-amber rounded px-1.5 py-0.5 text-[10px] shadow-[0_1px_0_var(--brd2)]">未捕获到按键 — 该组合可能被 app 菜单或系统占用（⌘Q / ⌘H / ⌘M / ⌘W / ⌘⇧P）</span>
        ) : (
          <span className="key bg-accdim border border-acc text-acc rounded px-1.5 py-0.5 text-[10.5px] font-mono shadow-[0_1px_0_var(--brd2)]">按下快捷键…</span>
        )
      ) : (
        currentKeys.map((k, i) => (
          <span key={i}>
            {i > 0 && <span className="text-t3 text-[9px]">+</span>}
            <span className="key bg-surf2 border border-brd2 rounded px-1.5 py-0.5 text-[10.5px] font-mono text-t1 shadow-[0_1px_0_var(--brd2)]">{k}</span>
          </span>
        ))
      )}
    </div>
  );
}

const NAV_GROUPS = [
  { label: '通用', items: [
    { id: 'appearance' as SettingsTab, icon: '🖥', name: '外观' },
    { id: 'editor' as SettingsTab, icon: '✏️', name: '编辑器' },
    { id: 'shortcuts' as SettingsTab, icon: '⌨️', name: '快捷键' },
    { id: 'templates' as SettingsTab, icon: '📄', name: '文件模板' },
    { id: 'pet' as SettingsTab, icon: '🐾', name: '桌宠' },
    { id: 'notifications' as SettingsTab, icon: '🔔', name: '通知' },
    { id: 'plugins' as SettingsTab, icon: '🧩', name: '插件' },
  ]},
  { label: 'AI', items: [
    { id: 'ai' as SettingsTab, icon: '✦', name: 'AI 工具' },
    { id: 'voice' as SettingsTab, icon: '🎤', name: '语音输入' },
    { id: 'skills' as SettingsTab, icon: '⚡', name: 'Skills' },
  ]},
  { label: '关于', items: [
    { id: 'about' as SettingsTab, icon: 'ℹ️', name: '关于 Quill' },
  ]},
];

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`sw2 w-9 h-5 rounded-[10px] cursor-pointer relative transition-[background] duration-200 shrink-0 ${value ? 'bg-acc' : 'bg-brd2'}`} onClick={() => onChange(!value)}>
      <div className={`absolute w-4 h-4 rounded-full bg-white top-0.5 left-0.5 transition-transform duration-200 ${value ? 'translate-x-4' : ''}`} />
    </div>
  );
}


function FileTemplatesSettings() {
  const fileTemplates = usePrefsStore((s) => s.fileTemplates);
  const setFileTemplates = usePrefsStore((s) => s.setFileTemplates);
  const [editingExt, setEditingExt] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [newExt, setNewExt] = useState('');
  const newExtRef = useRef<HTMLInputElement>(null);

  const extensions = Object.keys(fileTemplates).sort();

  const startEdit = useCallback((ext: string) => {
    setEditingExt(ext);
    setEditContent(fileTemplates[ext] || '');
  }, [fileTemplates]);

  const saveEdit = useCallback(() => {
    if (editingExt === null) return;
    setFileTemplates({ ...fileTemplates, [editingExt]: editContent });
    setEditingExt(null);
    setEditContent('');
  }, [editingExt, editContent, fileTemplates, setFileTemplates]);

  const cancelEdit = useCallback(() => {
    setEditingExt(null);
    setEditContent('');
  }, []);

  const addTemplate = useCallback(() => {
    const ext = newExt.trim().replace(/^\./, '').toLowerCase();
    if (!ext || fileTemplates[ext] !== undefined) return;
    setFileTemplates({ ...fileTemplates, [ext]: '' });
    setNewExt('');
    startEdit(ext);
  }, [newExt, fileTemplates, setFileTemplates, startEdit]);

  const removeTemplate = useCallback((ext: string) => {
    const next = { ...fileTemplates };
    delete next[ext];
    setFileTemplates(next);
    if (editingExt === ext) cancelEdit();
  }, [fileTemplates, setFileTemplates, editingExt, cancelEdit]);

  return (
    <div className="mb-[26px]">
      <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">File Templates</div>
      <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">
        按文件扩展名配置新建文件时的默认模板内容。支持变量：{'{{title}}'}, {'{{filename}}'}, {'{{date}}'}, {'{{ext}}'}
      </div>

      {/* Template list */}
      <div className="flex flex-col gap-1 mb-3">
        {extensions.map((ext) => (
          <div
            key={ext}
            className={`flex items-center gap-2 py-2 px-2.5 rounded-md border cursor-pointer transition-all duration-100 ${editingExt === ext ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`}
            onClick={() => startEdit(ext)}
          >
            <span className="text-xs font-mono font-semibold text-acc shrink-0">.{ext}</span>
            <span className="text-[11px] text-t3 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono">
              {fileTemplates[ext] ? fileTemplates[ext].slice(0, 60).replace(/\n/g, '\\n') : '(empty)'}
            </span>
            <button
              className="text-[10px] text-t3 hover:text-[#e53935] shrink-0 bg-transparent border-none cursor-pointer p-1"
              onClick={(e) => { e.stopPropagation(); removeTemplate(ext); }}
              title="删除模板"
            >
              ✕
            </button>
          </div>
        ))}
        {extensions.length === 0 && (
          <div className="text-xs text-t3 py-2">暂无模板配置</div>
        )}
      </div>

      {/* Add new template */}
      <div className="flex items-center gap-1.5 mb-4">
        <span className="text-xs text-t2">.</span>
        <input
          ref={newExtRef}
          className="fi2 py-[5px] px-2 rounded-md border border-brd bg-inp text-t1 text-xs outline-none font-mono transition-[border-color] duration-100 focus:border-acc"
          style={{ width: 100 }}
          value={newExt}
          onChange={(e) => setNewExt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') addTemplate(); }}
          placeholder="ext"
          autoCapitalize="off"
        />
        <button className="btn btn-p btn-sm" onClick={addTemplate}>添加模板</button>
      </div>

      {/* Editor */}
      {editingExt !== null && (
        <div className="mb-3">
          <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">
            编辑模板: <span className="font-mono text-acc">.{editingExt}</span>
          </div>
          <textarea
            className="w-full py-2 px-2.5 rounded-md border border-brd bg-inp text-t1 text-xs outline-none font-mono transition-[border-color] duration-100 focus:border-acc"
            rows={10}
            style={{ resize: 'vertical', lineHeight: 1.6, tabSize: 2 }}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
          />
          <div className="flex gap-1.5 mt-2">
            <button className="btn btn-p btn-sm" onClick={saveEdit}>保存</button>
            <button className="btn btn-g btn-sm" onClick={cancelEdit}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

const FORMAT_OPTIONS: { value: SkillOutputFormat; label: string }[] = [
  { value: 'json', label: 'JSON' },
  { value: 'tags-html', label: 'Tags + HTML' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'html', label: 'HTML' },
];

function formatBadge(format: string) {
  const map: Record<string, string> = {
    json: 'bg-[#e3f2fd] text-[#1565c0]',
    'tags-html': 'bg-[#fce4ec] text-[#c62828]',
    markdown: 'bg-[#e8f5e9] text-[#2e7d32]',
    html: 'bg-[#fff8e1] text-[#f57f17]',
  };
  const cls = map[format] || 'bg-surf2 text-t2';
  return (
    <span className={`text-[9.5px] font-mono font-semibold px-1.5 py-[1px] rounded ${cls}`}>
      {format}
    </span>
  );
}

function SkillsSettings() {
  const allSkills = useSkillStore(useShallow((s) => s.getAllSkills()));
  const updateSkill = useSkillStore((s) => s.updateSkill);
  const resetSkill = useSkillStore((s) => s.resetSkill);
  const createSkill = useSkillStore((s) => s.createSkill);
  const deleteSkill = useSkillStore((s) => s.deleteSkill);
  const importSkill = useSkillStore((s) => s.importSkill);
  const exportSkill = useSkillStore((s) => s.exportSkill);
  const capabilitySkills = useSkillStore((s) => s.capabilitySkills);
  const setCapabilitySkill = useSkillStore((s) => s.setCapabilitySkill);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', description: '', content: '', outputFormat: 'json' as SkillOutputFormat });
  const [isCreating, setIsCreating] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // New skill creation form state
  const [newId, setNewId] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const [newFormat, setNewFormat] = useState<SkillOutputFormat>('json');

  const selectedSkill = selectedId ? (allSkills.find((s) => s.id === selectedId) || undefined) : undefined;

  const selectSkill = useCallback((id: string) => {
    const skill = allSkills.find((s) => s.id === id);
    if (!skill) return;
    setSelectedId(id);
    setForm({ name: skill.name, description: skill.description, content: skill.content, outputFormat: skill.outputFormat });
    setIsCreating(false);
    setErrorMsg('');
  }, [allSkills]);

  const handleSave = useCallback(() => {
    if (!selectedId) return;
    updateSkill(selectedId, { name: form.name, description: form.description, content: form.content, outputFormat: form.outputFormat });
  }, [selectedId, form, updateSkill]);

  const handleReset = useCallback(() => {
    if (!selectedId) return;
    if (!window.confirm('确定恢复默认设置？未保存的修改将丢失。')) return;
    resetSkill(selectedId);
    const skill = builtinSkills[selectedId];
    if (skill) {
      setForm({ name: skill.name, description: skill.description, content: skill.content, outputFormat: skill.outputFormat });
    }
  }, [selectedId, resetSkill]);

  const handleDelete = useCallback(() => {
    if (!selectedId) return;
    if (!window.confirm('确定删除此 Skill？此操作不可撤销。')) return;
    deleteSkill(selectedId);
    setSelectedId(null);
  }, [selectedId, deleteSkill]);

  const startCreate = useCallback(() => {
    setIsCreating(true);
    setSelectedId(null);
    setNewId('');
    setNewName('');
    setNewDesc('');
    setNewPrompt('');
    setNewFormat('json');
    setErrorMsg('');
  }, []);

  const cancelCreate = useCallback(() => {
    setIsCreating(false);
    setErrorMsg('');
  }, []);

  const confirmCreate = useCallback(() => {
    const id = newId.trim();
    if (!id || !newName.trim()) {
      setErrorMsg('ID 和名称为必填项');
      return;
    }
    try {
      createSkill({
        id,
        name: newName.trim(),
        description: newDesc.trim(),
        version: '1.0.0',
        builtin: false,
        content: newPrompt,
        outputFormat: newFormat,
      });
      setIsCreating(false);
      setErrorMsg('');
      setSelectedId(id);
      setForm({ name: newName.trim(), description: newDesc.trim(), content: newPrompt, outputFormat: newFormat });
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : '创建失败');
    }
  }, [newId, newName, newDesc, newPrompt, newFormat, createSkill]);

  const handleImport = useCallback(async () => {
    setErrorMsg('');
    try {
      if (isTauri()) {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const { readTextFile } = await import('@tauri-apps/plugin-fs');
        const filePath = await open({ filters: [{ name: 'JSON', extensions: ['json'] }], multiple: false });
        if (!filePath) return;
        const content = await readTextFile(filePath as string);
        importSkill(content);
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : '导入失败');
    }
  }, [importSkill]);

  const handleExport = useCallback(async () => {
    if (!selectedId) return;
    setErrorMsg('');
    try {
      const json = exportSkill(selectedId);
      if (isTauri()) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        const filePath = await save({ defaultPath: `${selectedId}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
        if (!filePath) return;
        await writeTextFile(filePath, json);
      }
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : '导出失败');
    }
  }, [selectedId, exportSkill]);

  const slugify = useCallback((name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '');
  }, []);

  return (
    <div className="mb-[26px]">
      <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">Skills</div>
      <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">
        配置 AI 技能模板，自定义 Prompt 以控制 AI 生成内容的格式和质量
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-1.5 mb-3">
        <button className="btn btn-p btn-sm" onClick={startCreate}>新建 Skill</button>
        <button className="btn btn-g btn-sm" onClick={handleImport}>导入</button>
        {selectedId && !isCreating && (
          <button className="btn btn-g btn-sm" onClick={handleExport}>导出</button>
        )}
      </div>

      {/* Capability Assignment */}
      <div className="mb-3 border border-brd rounded-md p-3">
        <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-2">功能绑定</div>
        <div className="text-[10.5px] text-t3 mb-2.5">为每个功能指定使用的 SKILL，Claude Code 将根据对应 SKILL 的指令完成任务</div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-t1 shrink-0" style={{ width: 100 }}>网页剪藏</span>
            <select
              className="settings-select flex-1"
              value={capabilitySkills.clip || ''}
              onChange={(e) => setCapabilitySkill('clip' as SkillCapability, e.target.value)}
            >
              {allSkills.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.id})</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-t1 shrink-0" style={{ width: 100 }}>GitHub 分析</span>
            <select
              className="settings-select flex-1"
              value={capabilitySkills['github-analysis'] || ''}
              onChange={(e) => setCapabilitySkill('github-analysis' as SkillCapability, e.target.value)}
            >
              {allSkills.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.id})</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="text-[11px] text-[#e53935] mb-2">{errorMsg}</div>
      )}

      {/* Skill list */}
      <div className="flex flex-col gap-1 mb-3">
        {allSkills.map((skill) => (
          <div
            key={skill.id}
            className={`flex items-center gap-2 py-2 px-2.5 rounded-md border cursor-pointer transition-all duration-100 ${selectedId === skill.id && !isCreating ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`}
            onClick={() => selectSkill(skill.id)}
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-t1">{skill.name}</span>
                {formatBadge(skill.outputFormat)}
                <span className={`text-[9px] font-medium px-1 py-[0.5px] rounded ${skill.builtin ? 'bg-surf2 text-t3' : 'bg-[#e8f5e9] text-[#2e7d32]'}`}>
                  {skill.builtin ? 'Built-in' : 'Custom'}
                </span>
              </div>
              {skill.description && (
                <div className="text-[10.5px] text-t3 mt-[1px] overflow-hidden text-ellipsis whitespace-nowrap">{skill.description}</div>
              )}
            </div>
          </div>
        ))}
        {allSkills.length === 0 && (
          <div className="text-xs text-t3 py-2">暂无 Skill 配置</div>
        )}
      </div>

      {/* New Skill creation form */}
      {isCreating && (
        <div className="border border-brd rounded-md p-3 mb-3">
          <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-2.5">新建 Skill</div>
          <div className="mb-2.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">ID</div>
            <input
              className="fi2 w-full py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-xs outline-none font-mono transition-[border-color] duration-100 focus:border-acc"
              value={newId}
              onChange={(e) => setNewId(slugify(e.target.value))}
              placeholder="my-custom-skill"
              autoCapitalize="off"
            />
            <div className="text-[10px] text-t3 mt-[2px]">Slug 格式，仅小写字母、数字和连字符</div>
          </div>
          <div className="mb-2.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">名称</div>
            <input
              className="fi2 w-full py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-xs outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
              value={newName}
              onChange={(e) => { setNewName(e.target.value); if (!newId) setNewId(slugify(e.target.value)); }}
              placeholder="My Custom Skill"
            />
          </div>
          <div className="mb-2.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">描述</div>
            <input
              className="fi2 w-full py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-xs outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="描述此 Skill 的用途"
            />
          </div>
          <div className="mb-2.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">Prompt 模板</div>
            <textarea
              className="w-full py-2 px-2.5 rounded-md border border-brd bg-inp text-t1 text-xs outline-none font-mono transition-[border-color] duration-100 focus:border-acc"
              rows={8}
              style={{ resize: 'vertical', lineHeight: 1.6, tabSize: 2 }}
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="输入 Prompt 模板，使用 {{variableName}} 引用变量..."
            />
          </div>
          <div className="mb-2.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">输出格式</div>
            <select
              className="settings-select"
              style={{ maxWidth: 200 }}
              value={newFormat}
              onChange={(e) => setNewFormat(e.target.value as SkillOutputFormat)}
            >
              {FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-1.5 mt-2">
            <button className="btn btn-p btn-sm" onClick={confirmCreate}>创建</button>
            <button className="btn btn-g btn-sm" onClick={cancelCreate}>取消</button>
          </div>
        </div>
      )}

      {/* Edit form for selected skill */}
      {selectedSkill && !isCreating && (
        <div className="border border-brd rounded-md p-3">
          <div className="flex items-center justify-between mb-2.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
              编辑: <span className="font-mono text-acc">{selectedSkill.id}</span>
            </div>
            <span className={`text-[9.5px] font-medium px-1.5 py-[1px] rounded ${selectedSkill.builtin ? 'bg-surf2 text-t3' : 'bg-[#e8f5e9] text-[#2e7d32]'}`}>
              {selectedSkill.builtin ? 'Built-in' : 'Custom'}
            </span>
          </div>

          {/* Name */}
          <div className="mb-2.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">名称</div>
            <input
              className="fi2 w-full py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-xs outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          {/* Description */}
          <div className="mb-2.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">描述</div>
            <input
              className="fi2 w-full py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-xs outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          {/* Skill Content */}
          <div className="mb-2.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">Skill 内容</div>
            <textarea
              className="w-full py-2 px-2.5 rounded-md border border-brd bg-inp text-t1 text-xs outline-none font-mono transition-[border-color] duration-100 focus:border-acc"
              rows={12}
              style={{ resize: 'vertical', lineHeight: 1.6, tabSize: 2 }}
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
            />
          </div>

          {/* Output Format */}
          <div className="mb-2.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">输出格式</div>
            <select
              className="settings-select"
              style={{ maxWidth: 200 }}
              value={form.outputFormat}
              onChange={(e) => setForm((f) => ({ ...f, outputFormat: e.target.value as SkillOutputFormat }))}
            >
              {FORMAT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Action buttons */}
          <div className="flex gap-1.5 mt-3">
            <button className="btn btn-p btn-sm" onClick={handleSave}>保存</button>
            {selectedSkill.builtin && (
              <button className="btn btn-g btn-sm" onClick={handleReset}>恢复默认</button>
            )}
            {!selectedSkill.builtin && (
              <button
                className="py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 border-[#e53935] bg-transparent text-[#e53935] hover:bg-[#fce4ec]"
                onClick={handleDelete}
              >删除</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Pet settings tab (PRD: settings-pet-tab-and-custom-icon). Surfaces:
 *  - Toggle "显示桌宠" bound to existing `petModeEnabled` / `setPetModeEnabled`
 *    (the pet window's visibility is owned by the host; this only persists
 *    the user's preference, which the App startup effect re-applies).
 *  - Icon source radio: 默认 (inline SVG) vs. 自定义 (`<img>` from
 *    `petIconPath`). 自定义 with no path yet triggers the upload picker.
 *  - "上传图标…" button: native file picker (png/jpg/jpeg/webp/svg,
 *    ≤1MB) → copy file to `appDataDir/pet-icon.<ext>` → `setPetIcon('custom', path)`.
 *    Files >1MB or non-image extensions are rejected with a local error
 *    message (no toast system reused — the existing settings sections use
 *    local `errorMsg` state, so we follow that pattern).
 *  - "恢复默认" button: deletes any `pet-icon.<ext>` file in appDataDir +
 *    `setPetIcon('builtin')`.
 *  - Preview thumbnail of the current icon (builtin quill.svg or the
 *    custom image via `convertFileSrc`).
 *
 * ACL: the main window's capability file (`capabilities/default.json`)
 * already grants `fs:allow-exists`, `fs:allow-remove`, `fs:allow-read-dir`,
 * `fs:allow-stat`, `fs:allow-read-file`, `fs:allow-write-file`, plus
 * `dialog:default` and `fs:scope-appdata-recursive`. No capability changes
 * needed for the upload/reset flows here.
 */
function PetSettings() {
  const petModeEnabled = usePetStore((s) => s.petModeEnabled);
  const setPetModeEnabled = usePetStore((s) => s.setPetModeEnabled);
  const petIconSource = usePetStore((s) => s.petIconSource);
  const petIconPath = usePetStore((s) => s.petIconPath);
  const setPetIcon = usePetStore((s) => s.setPetIcon);
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState(false);

  /** Accepted image extensions for the custom icon (PRD: png/jpg/webp/svg). */
  const VALID_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'svg'];
  /** File-size cap: 1MB (PRD). Rejected oversized files instead of resizing. */
  const MAX_ICON_BYTES = 1024 * 1024;

  // Cross-window icon-change broadcast. The `pet` Tauri window has its own
  // JS context + its own Zustand store instance; `storageClient`'s in-memory
  // cache is per-window with no cross-window invalidation, so a `setPetIcon`
  // call here only updates the main window's store. The pet window would keep
  // rendering the stale icon until next launch. Emit `pet://icon-changed` so
  // `PetApp.tsx`'s listener can `setState` on its own store instance. Guarded
  // with `isTauri()` so non-Tauri/test envs skip the dynamic import. The
  // payload shape is `{ source, path }` so the listener can blindly apply it.
  const emitIconChanged = useCallback(async (source: 'builtin' | 'custom', path: string) => {
    if (!isTauri()) return;
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit('pet://icon-changed', { source, path });
    } catch {
      // Non-fatal — the pet window will pick up the change on next launch.
    }
  }, []);

  const handleUploadIcon = useCallback(async () => {
    setErrorMsg('');
    if (busy) return;
    setBusy(true);
    try {
      if (!isTauri()) {
        setErrorMsg('桌面端功能，请在 Tauri 环境中使用');
        return;
      }
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readFile, writeFile, stat, remove, readDir } = await import('@tauri-apps/plugin-fs');
      const { appDataDir, join } = await import('@tauri-apps/api/path');

      const picked = await open({
        filters: [{ name: 'Image', extensions: VALID_EXTS }],
        multiple: false,
      });
      // `open()` returns `string | null | string[]`; with `multiple: false`
      // it's `string | null`. Treat null/[]/array as "user cancelled".
      if (!picked || Array.isArray(picked)) return;
      const filePath = picked as string;

      // Validate extension (the dialog filter restricts, but the user can
      // bypass via "All files" on some platforms — defensive validate).
      const ext = (filePath.split('.').pop() || '').toLowerCase();
      if (!VALID_EXTS.includes(ext)) {
        setErrorMsg('仅支持 png / jpg / webp / svg 格式');
        return;
      }

      // Validate file size (PRD: 1MB cap, reject instead of resizing).
      let size = 0;
      try {
        const s = await stat(filePath);
        size = s.size;
      } catch {
        // stat can fail on permission edge cases; treat as 0 and let
        // readFile surface a real error if the file is unreadable.
        size = 0;
      }
      if (size > MAX_ICON_BYTES) {
        setErrorMsg(`文件大小不能超过 1MB（当前 ${(size / 1024).toFixed(0)} KB）`);
        return;
      }

      // Copy file to appDataDir/pet-icon.<ext>. The appDataDir is created
      // on demand by `writeFile` (fs plugin creates parent dirs). Delete
      // any prior pet-icon.<ext> with a DIFFERENT extension first so the
      // orphan doesn't linger (same-extension writes overwrite directly).
      const appData = await appDataDir();
      const destPath = await join(appData, `pet-icon.${ext}`);
      try {
        const entries = await readDir(appData);
        for (const e of entries) {
          if (e.name.startsWith('pet-icon.') && e.name !== `pet-icon.${ext}`) {
            try { await remove(await join(appData, e.name)); } catch {}
          }
        }
      } catch {
        // readDir on appDataDir can fail on first launch (dir doesn't
        // exist yet) — non-fatal, writeFile creates it.
      }

      const bytes = await readFile(filePath);
      if (bytes.length > MAX_ICON_BYTES) {
        // Re-check after read in case stat underreported (defensive).
        setErrorMsg(`文件大小不能超过 1MB（当前 ${(bytes.length / 1024).toFixed(0)} KB）`);
        return;
      }
      await writeFile(destPath, bytes);
      setPetIcon('custom', destPath);
      await emitIconChanged('custom', destPath);
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : '上传失败');
    } finally {
      setBusy(false);
    }
  }, [busy, setPetIcon, emitIconChanged]);

  const handleTogglePetMode = useCallback(async (v: boolean) => {
    // Optimistic store update so the toggle feels snappy; then invoke the
    // Rust `toggle_pet_mode` command so the actual Tauri window state matches.
    // `toggle_pet_mode` is a *toggle* (not set-absolute), so only call it when
    // the new value differs from the current state — otherwise it would flip
    // the window the wrong way. The `pet://visibility-changed` listener in
    // App.tsx syncs the store flag back from Rust's authoritative state, so
    // if the optimistic update disagrees with Rust, Rust wins.
    if (v === petModeEnabled) return;
    setPetModeEnabled(v);
    if (!isTauri()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('toggle_pet_mode');
    } catch {
      // Non-fatal — the visibility-changed event will reconcile the flag.
    }
  }, [petModeEnabled, setPetModeEnabled]);

  const handleResetIcon = useCallback(async () => {
    setErrorMsg('');
    try {
      if (!isTauri()) {
        setPetIcon('builtin');
        await emitIconChanged('builtin', '');
        return;
      }
      const { remove, readDir } = await import('@tauri-apps/plugin-fs');
      const { appDataDir, join } = await import('@tauri-apps/api/path');
      const appData = await appDataDir();
      // Delete any pet-icon.<ext> files in appDataDir (covers all extensions
      // so a switch from png → svg → reset doesn't leave the png behind).
      try {
        const entries = await readDir(appData);
        for (const e of entries) {
          if (e.name.startsWith('pet-icon.')) {
            try { await remove(await join(appData, e.name)); } catch {}
          }
        }
      } catch {
        // Non-fatal; the flag still clears.
      }
      setPetIcon('builtin');
      await emitIconChanged('builtin', '');
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : '重置失败');
    }
  }, [setPetIcon, emitIconChanged]);

  const handleSelectCustom = useCallback(() => {
    // Radio "自定义": if a custom icon is already uploaded, just switch
    // the source flag; if not, trigger the upload picker so the user can
    // pick one (selecting "自定义" with no path would render nothing).
    if (petIconPath) {
      setPetIcon('custom', petIconPath);
      void emitIconChanged('custom', petIconPath);
    } else {
      void handleUploadIcon();
    }
  }, [petIconPath, setPetIcon, handleUploadIcon, emitIconChanged]);

  // Preview thumbnail: builtin quill.svg (served from the app's public dir)
  // or the custom image via `convertFileSrc` (resolved in `CustomIconPreview`
  // so the Tauri-only module is only imported when actually rendering a
  // custom preview). The asset protocol scope in tauri.conf.json allows
  // `$APPDATA/**` so appDataDir paths resolve.
  const builtinPreviewSrc = `${import.meta.env.BASE_URL}quill.svg`;

  return (
    <div className="mb-[26px]">
      <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">桌宠</div>
      <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">配置桌面宠物图标与显示</div>

      {/* 显示桌宠 toggle — reuses the existing petModeEnabled flag */}
      <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">显示桌宠</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">在屏幕上显示桌面宠物窗口（macOS）</p>
        </div>
        <Toggle value={petModeEnabled} onChange={(v) => void handleTogglePetMode(v)} />
      </div>

      {/* 图标 source radio */}
      <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">图标</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">默认使用内置 Quill 图标，或上传自定义图片</p>
        </div>
        <div className="flex gap-1">
          <button
            className={`py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 ${petIconSource === 'builtin' ? 'border-acc bg-accdim text-acc' : 'border-brd bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
            onClick={() => {
              setPetIcon('builtin');
              void emitIconChanged('builtin', '');
            }}
          >默认</button>
          <button
            className={`py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 ${petIconSource === 'custom' ? 'border-acc bg-accdim text-acc' : 'border-brd bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
            onClick={handleSelectCustom}
          >自定义</button>
        </div>
      </div>

      {/* Preview + upload / reset actions */}
      <div className="flex items-center gap-3 mt-3">
        <div className="w-14 h-14 rounded-md border border-brd2 bg-surf2 flex items-center justify-center overflow-hidden shrink-0">
          {petIconSource === 'custom' && petIconPath && isTauri() ? (
            <CustomIconPreview path={petIconPath} onError={() => {
              setPetIcon('builtin');
              void emitIconChanged('builtin', '');
            }} />
          ) : (
            <img src={builtinPreviewSrc} alt="Quill" className="w-12 h-12" />
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <button
              className="btn btn-g btn-sm"
              disabled={busy}
              onClick={() => void handleUploadIcon()}
            >{busy ? '上传中…' : '上传图标…'}</button>
            <button
              className="btn btn-g btn-sm"
              disabled={petIconSource === 'builtin' && !petIconPath}
              onClick={() => void handleResetIcon()}
            >恢复默认</button>
          </div>
          <div className="text-[10.5px] text-t3">支持 png / jpg / webp / svg，≤ 1MB</div>
        </div>
      </div>

      {errorMsg && (
        <div className="text-[11px] text-[#e53935] mt-2">{errorMsg}</div>
      )}
    </div>
  );
}

/**
 * Preview `<img>` for a custom pet icon. Resolves `convertFileSrc` lazily
 * (Tauri-only module) and falls back to the builtin quill.svg if the
 * conversion or load fails. Kept as a separate component so the lazy import
 * only runs when actually rendering a custom preview (the common case —
 * builtin — never touches Tauri).
 */
interface CustomIconPreviewProps {
  path: string;
  onError: () => void;
}

function CustomIconPreview({ path, onError }: CustomIconPreviewProps) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { convertFileSrc } = await import('@tauri-apps/api/core');
        if (!cancelled) setSrc(convertFileSrc(path));
      } catch {
        if (!cancelled) onError();
      }
    })();
    return () => { cancelled = true; };
  }, [path, onError]);
  if (!src) {
    // Placeholder while the lazy import resolves — 48×48 transparent box.
    return <div className="w-12 h-12" />;
  }
  return (
    <img
      src={src}
      alt="自定义图标"
      className="w-12 h-12"
      style={{ objectFit: 'contain' }}
      onError={onError}
    />
  );
}

function NotificationsSettings() {
  const notificationForm = usePetStore((s) => s.notificationForm);
  const setNotificationForm = usePetStore((s) => s.setNotificationForm);
  const options: { value: NotificationForm; label: string }[] = [
    { value: 'bubble', label: '宠物头顶气泡' },
    { value: 'system', label: '系统通知' },
    { value: 'both', label: '两者都发' },
    { value: 'off', label: '关闭' },
  ];
  return (
    <div className="mb-[26px]">
      <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">通知</div>
      <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">选择桌面宠物事件通知的形式</div>
      <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
        <div className="tr-info">
          <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">通知形式</h4>
          <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">气泡浮于宠物头顶；系统通知走 macOS 通知中心（失焦时仍可见）</p>
        </div>
        <select
          className="settings-select"
          style={{ maxWidth: 200 }}
          value={notificationForm}
          onChange={(e) => setNotificationForm(e.target.value as NotificationForm)}
        >
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const settingsTab = useNavStore((s) => s.settingsTab);
  const setSettingsTab = useNavStore((s) => s.setSettingsTab);
  const setCurrentPage = useNavStore((s) => s.setCurrentPage);

  const theme = useAppearanceStore((s) => s.theme);
  const setTheme = useAppearanceStore((s) => s.setTheme);
  const fontSize = useAppearanceStore((s) => s.fontSize);
  const showAiPanel = useAppearanceStore((s) => s.showAiPanel);
  const showStatusBar = useAppearanceStore((s) => s.showStatusBar);
  const showHiddenFiles = useAppearanceStore((s) => s.showHiddenFiles);
  const enableWikiPanel = useAppearanceStore((s) => s.enableWikiPanel);
  const enableClipsPanel = useAppearanceStore((s) => s.enableClipsPanel);
  const enableAnalyzePanel = useAppearanceStore((s) => s.enableAnalyzePanel);
  const enableDailyPanel = useAppearanceStore((s) => s.enableDailyPanel);
  const excludePatterns = useAppearanceStore((s) => s.excludePatterns);
  const setFontSize = useAppearanceStore((s) => s.setFontSize);
  const setShowAiPanel = useAppearanceStore((s) => s.setShowAiPanel);
  const setShowStatusBar = useAppearanceStore((s) => s.setShowStatusBar);
  const setShowHiddenFiles = useAppearanceStore((s) => s.setShowHiddenFiles);
  const setEnableWikiPanel = useAppearanceStore((s) => s.setEnableWikiPanel);
  const setEnableClipsPanel = useAppearanceStore((s) => s.setEnableClipsPanel);
  const setEnableAnalyzePanel = useAppearanceStore((s) => s.setEnableAnalyzePanel);
  const setEnableDailyPanel = useAppearanceStore((s) => s.setEnableDailyPanel);
  const setExcludePatterns = useAppearanceStore((s) => s.setExcludePatterns);
  const linkOpenMode = useAppearanceStore((s) => s.linkOpenMode);
  const setLinkOpenMode = useAppearanceStore((s) => s.setLinkOpenMode);

  const editorFont = useEditorPrefsStore((s) => s.editorFont);
  const editorFontSize = useEditorPrefsStore((s) => s.editorFontSize);
  const tabSize = useEditorPrefsStore((s) => s.tabSize);
  const showLineNumbers = useEditorPrefsStore((s) => s.showLineNumbers);
  const autoSave = useEditorPrefsStore((s) => s.autoSave);
  const setEditorFont = useEditorPrefsStore((s) => s.setEditorFont);
  const setEditorFontSize = useEditorPrefsStore((s) => s.setEditorFontSize);
  const setTabSize = useEditorPrefsStore((s) => s.setTabSize);
  const setShowLineNumbers = useEditorPrefsStore((s) => s.setShowLineNumbers);
  const setAutoSave = useEditorPrefsStore((s) => s.setAutoSave);

  const dailyNotesDir = usePrefsStore((s) => s.dailyNotesDir);
  const dailyNoteDateFormat = usePrefsStore((s) => s.dailyNoteDateFormat);
  const shortcuts = usePrefsStore((s) => s.shortcuts);
  const setDailyNotesDir = usePrefsStore((s) => s.setDailyNotesDir);
  const setDailyNoteDateFormat = usePrefsStore((s) => s.setDailyNoteDateFormat);
  const resetShortcuts = usePrefsStore((s) => s.resetShortcuts);

  const cliAdapter = useAiConfigStore((s) => s.cliAdapter);
  const cliPath = useAiConfigStore((s) => s.cliPath);
  const chatProvider = useAiConfigStore((s) => s.chatProvider);
  const chatModel = useAiConfigStore((s) => s.chatModel);
  const chatApiKey = useAiConfigStore((s) => s.chatApiKey);
  const chatBaseUrl = useAiConfigStore((s) => s.chatBaseUrl);
  const setCliAdapter = useAiConfigStore((s) => s.setCliAdapter);
  const setCliPath = useAiConfigStore((s) => s.setCliPath);
  const setChatProvider = useAiConfigStore((s) => s.setChatProvider);
  const setChatModel = useAiConfigStore((s) => s.setChatModel);
  const setChatApiKey = useAiConfigStore((s) => s.setChatApiKey);
  const setChatBaseUrl = useAiConfigStore((s) => s.setChatBaseUrl);
  const [testStatus, setTestStatus] = useState<{ testing: boolean; result?: { success: boolean; message: string } }>({ testing: false });
  // ponytail: reuse the same state shape as `testStatus` for the Chat-mode ping
  // test. Separate state because both sections render simultaneously inside the
  // AI tab, so sharing one would have the CLI test clear the chat test result
  // (and vice versa) via the auto-clear setTimeout.
  const [chatTestStatus, setChatTestStatus] = useState<{ testing: boolean; result?: { success: boolean; message: string } }>({ testing: false });
  const [showChatKey, setShowChatKey] = useState(false);

  return (
    <div className="settings-page flex flex-row max-w-none h-full">
      {/* Left navigation */}
      <nav className="sn w-[190px] shrink-0 bg-panel border-r border-brd flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto py-[11px] px-[7px]">
          {NAV_GROUPS.map((group) => (
            <div className="mb-[13px]" key={group.label}>
              <div className="text-[9px] font-semibold text-t3 uppercase tracking-[.12em] px-2 mb-[3px]">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`sn-item flex items-center gap-2 py-[7px] px-[9px] rounded-md cursor-pointer text-[length:calc(var(--ui-font-size)-2px)] transition-all duration-100 border-none w-full text-left font-ui ${settingsTab === item.id ? 'bg-accdim text-acc' : 'text-t2 bg-transparent hover:bg-hov hover:text-t1'}`}
                  onClick={() => setSettingsTab(item.id)}
                >
                  {item.icon} {item.name}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="py-2 px-[7px] border-t border-brd shrink-0">
          <button className="sn-back-btn flex items-center gap-2 py-[7px] px-[9px] rounded-md cursor-pointer text-t2 text-[length:calc(var(--ui-font-size)-2px)] transition-all duration-100 border-none bg-transparent w-full text-left font-ui hover:bg-hov hover:text-t1" onClick={() => setCurrentPage('editor')}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <polyline points="10,2 4,8 10,14" />
            </svg>
            返回编辑器
          </button>
        </div>
      </nav>

      {/* Right panel */}
      <div className="sc2 w-[50vw] overflow-y-auto py-[22px] px-[26px]">
        {/* -- 外观 -- */}
        {settingsTab === 'appearance' && (
          <div className="mb-[26px]">
            <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">外观</div>
            <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">调整界面主题与字体显示</div>
            <div className="mb-3.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">界面主题</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                <div className={`theme-card p-[11px] cursor-pointer rounded-lg border transition-all duration-100 ${theme === 'dark' ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`} onClick={() => setTheme('dark')}>
                  <div className="h-[34px] rounded mb-[5px] border border-brd2" style={{ background: '#0b0d14' }} />
                  <div className="text-[11.5px] font-semibold text-t1 text-center">暗色</div>
                </div>
                <div className={`theme-card p-[11px] cursor-pointer rounded-lg border transition-all duration-100 ${theme === 'light' ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`} onClick={() => setTheme('light')}>
                  <div className="h-[34px] rounded mb-[5px] border border-brd2" style={{ background: '#f0f2f8' }} />
                  <div className="text-[11.5px] font-semibold text-t1 text-center">亮色</div>
                </div>
                <div className={`theme-card p-[11px] cursor-pointer rounded-lg border transition-all duration-100 ${theme === 'system' ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`} onClick={() => setTheme('system')}>
                  <div className="h-[34px] rounded mb-[5px] border border-brd2" style={{ background: 'linear-gradient(135deg, #0b0d14 50%, #f0f2f8 50%)' }} />
                  <div className="text-[11.5px] font-semibold text-t1 text-center">跟随系统</div>
                </div>
              </div>
            </div>
            <div className="mb-3.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">界面字体大小</div>
              <select className="settings-select" style={{ maxWidth: 180 }} value={`${fontSize}px`} onChange={(e) => setFontSize(parseInt(e.target.value))}>
                <option value="12px">12px（紧凑）</option>
                <option value="14px">14px（默认）</option>
                <option value="16px">16px（舒适）</option>
              </select>
            </div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">默认显示 AI 面板</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">打开编辑器时自动展开 AI 对话面板</p></div><Toggle value={showAiPanel} onChange={(v) => setShowAiPanel(v)} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">状态栏</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">底部显示字数、光标位置等信息</p></div><Toggle value={showStatusBar} onChange={(v) => setShowStatusBar(v)} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">显示隐藏文件</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">在文件树中显示以 . 开头的隐藏文件和文件夹</p></div><Toggle value={showHiddenFiles} onChange={(v) => { setShowHiddenFiles(v); import('@/store/vaultStore').then(m => m.useVaultStore.getState().refreshFileTree()); }} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">Wiki 面板</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">在侧栏显示 Wiki 知识库入口</p></div><Toggle value={enableWikiPanel} onChange={(v) => setEnableWikiPanel(v)} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">Clips 面板</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">在侧栏显示网页剪藏入口</p></div><Toggle value={enableClipsPanel} onChange={(v) => setEnableClipsPanel(v)} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">项目分析面板</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">在侧栏显示项目分析入口</p></div><Toggle value={enableAnalyzePanel} onChange={(v) => setEnableAnalyzePanel(v)} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">今日笔记面板</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">在侧栏显示日历与今日笔记入口（禁用后 ⌘D 也不再打开）</p></div><Toggle value={enableDailyPanel} onChange={(v) => setEnableDailyPanel(v)} /></div>
            <div className="mb-3.5 flex flex-col items-stretch gap-1.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">过滤文件/文件夹</div>
              <p style={{ fontSize: 11, color: 'var(--t3)', margin: 0 }}>每行一个规则，匹配的文件或文件夹将在文件树中隐藏。支持 * 和 ? 通配符，# 开头为注释。</p>
              <textarea
                className="fsel py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui w-full"
                rows={6}
                style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12, resize: 'vertical', lineHeight: 1.6, padding: '8px 10px' }}
                value={excludePatterns}
                onChange={(e) => setExcludePatterns(e.target.value)}
                onBlur={() => import('@/store/vaultStore').then(m => m.useVaultStore.getState().refreshFileTree())}
                placeholder={'node_modules\n.git\n.DS_Store\n*.log'}
              />
            </div>
          </div>
        )}

        {/* -- 编辑器 -- */}
        {settingsTab === 'editor' && (
          <div className="mb-[26px]">
            <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">编辑器</div>
            <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">配置编辑器行为与显示选项</div>
            <div className="grid grid-cols-3 gap-3 mb-3.5">
              <div><div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">编辑器字体</div><select className="settings-select" value={editorFont} onChange={(e) => setEditorFont(e.target.value)}><option>DM Mono</option><option>JetBrains Mono</option><option>Fira Code</option></select></div>
              <div><div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">字体大小</div><select className="settings-select" value={`${editorFontSize}px`} onChange={(e) => setEditorFontSize(parseInt(e.target.value))}><option value="12px">12px</option><option value="13px">13px</option><option value="14px">14px</option><option value="16px">16px</option></select></div>
              <div><div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">Tab 大小</div><select className="settings-select" value={tabSize} onChange={(e) => setTabSize(parseInt(e.target.value))}><option value={2}>2 空格</option><option value={4}>4 空格</option></select></div>
            </div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">显示行号</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">在编辑区左侧显示行号</p></div><Toggle value={showLineNumbers} onChange={(v) => setShowLineNumbers(v)} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd"><div className="tr-info"><h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">自动保存</h4><p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">每 30 秒自动保存当前文档</p></div><Toggle value={autoSave} onChange={(v) => setAutoSave(v)} /></div>
            <div className="tr flex items-center justify-between py-2.5 border-b border-brd">
              <div className="tr-info">
                <h4 className="text-[length:calc(var(--ui-font-size)-1.5px)] font-semibold text-t1 m-0 mb-0.5">链接打开方式</h4>
                <p className="text-[length:calc(var(--ui-font-size)-3px)] text-t3 m-0 leading-normal">点击链接时的默认打开方式</p>
              </div>
              <div className="flex gap-1">
                <button
                  className={`py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 ${linkOpenMode === 'external' ? 'border-acc bg-accdim text-acc' : 'border-brd bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
                  onClick={() => setLinkOpenMode('external')}
                >外部浏览器</button>
                <button
                  className={`py-[5px] px-3 rounded-md text-[11px] font-ui cursor-pointer border transition-all duration-100 ${linkOpenMode === 'internal' ? 'border-acc bg-accdim text-acc' : 'border-brd bg-surf text-t2 hover:bg-hov hover:text-t1'}`}
                  onClick={() => setLinkOpenMode('internal')}
                >应用内打开</button>
              </div>
            </div>
          </div>
        )}

        {/* -- 编辑器 -- Daily Notes section (appended below editor settings) */}
        {settingsTab === 'editor' && (
          <div className="mb-[26px]">
            <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">Daily Notes</div>
            <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">配置每日笔记的存储目录与日期格式</div>
            <div className="mb-3.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">笔记目录</div>
              <input
                className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
                style={{ maxWidth: 240 }}
                value={dailyNotesDir}
                onChange={(e) => setDailyNotesDir(e.target.value)}
                placeholder="daily"
                autoCapitalize="off"
              />
            </div>
            <div className="mb-3.5">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">日期格式</div>
              <select
                className="settings-select"
                style={{ maxWidth: 240 }}
                value={dailyNoteDateFormat}
                onChange={(e) => setDailyNoteDateFormat(e.target.value)}
              >
                <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                <option value="YYYY.MM.DD">YYYY.MM.DD</option>
                <option value="YYYYMMDD">YYYYMMDD</option>
              </select>
            </div>
          </div>
        )}

        {/* -- 快捷键 -- */}
        {settingsTab === 'shortcuts' && (
          <div className="mb-[26px]">
            <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">快捷键</div>
            <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">点击快捷键区域可重新录入，按下新的组合键即可修改</div>
            {shortcuts.map((shortcut) => (
              <div className="sk-row flex items-center justify-between py-2 border-b border-brd last:border-b-0" key={shortcut.id}>
                <span className="text-xs text-t2">{shortcut.name}</span>
                <ShortcutEditor shortcutId={shortcut.id} currentKeys={shortcut.keys} />
              </div>
            ))}
            <div style={{ marginTop: 14, display: 'flex', gap: 7 }}>
              <button className="btn btn-g btn-sm" onClick={() => resetShortcuts()}>恢复默认</button>
            </div>
          </div>
        )}

        {/* -- AI 工具 -- */}
        {settingsTab === 'ai' && (
          <div className="mb-[26px]">
            <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1 mb-[3px] tracking-[-0.01em]">AI 工具</div>
            <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3.5">配置 AI CLI 工具，用于智能编辑文档</div>
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-2 flex items-center gap-1.5">CLI 适配器</div>
            <div className="ml flex flex-col gap-1">
              {listAdapters().map((a) => (
                <div
                  key={a.id}
                  className={`mi flex items-center justify-between py-2 px-2.5 rounded-md border cursor-pointer transition-all duration-100 ${cliAdapter === a.id ? 'border-acc bg-accdim' : 'border-brd hover:border-acc'}`}
                  onClick={() => setCliAdapter(a.id)}
                >
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full border-2 shrink-0 ${cliAdapter === a.id ? 'bg-acc border-acc' : 'border-brd2'}`} />
                    <div>
                      <div className="text-xs font-semibold text-t1 font-mono">{a.displayName}</div>
                      <div className="text-[10px] text-t3 mt-px">{a.description}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="mb-3.5 mt-4">
              <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px] flex items-center gap-1.5">CLI 路径</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc" style={{ flex: 1 }} value={cliPath} onChange={(e) => setCliPath(e.target.value)} placeholder="claude" autoCapitalize="off" />
                <button
                  className="btn btn-g btn-sm"
                  title="自动检测路径"
                  onClick={async () => {
                    try {
                      const { Command } = await import('@tauri-apps/plugin-shell');
                      const adapterCmd = cliAdapter === 'claude' ? 'claude' : cliAdapter;
                      const cmd = Command.create('claude-cli', ['-l', '-c', `which ${adapterCmd}`]);
                      const output = await cmd.execute();
                      const detected = output.stdout.trim().split('\n')[0];
                      if (output.code === 0 && detected) {
                        setCliPath(detected);
                      }
                    } catch {}
                  }}
                >检测</button>
              </div>
              <div className="text-[10.5px] text-t3 mt-1">CLI 可执行文件的路径或命令名，点击"检测"自动查找</div>
            </div>
            <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 8 }}>
              <button
                className="btn btn-g btn-sm"
                disabled={testStatus.testing}
                onClick={async () => {
                  setTestStatus({ testing: true });
                  try {
                    const { Command } = await import('@tauri-apps/plugin-shell');
                    const cliPath = useAiConfigStore.getState().cliPath || 'claude';
                    const cmd = Command.create('claude-cli', ['-l', '-c', `${cliPath} --version`]);
                    const output = await cmd.execute();
                    if (output.code === 0) {
                      const version = output.stdout.trim().split('\n')[0];
                      setTestStatus({ testing: false, result: { success: true, message: version || '连接成功' } });
                    } else {
                      setTestStatus({ testing: false, result: { success: false, message: output.stderr.trim() || `退出码 ${output.code}` } });
                    }
                  } catch (err) {
                    setTestStatus({ testing: false, result: { success: false, message: `无法执行 CLI: ${String(err)}` } });
                  }
                  setTimeout(() => setTestStatus((s) => ({ ...s, result: undefined })), 6000);
                }}
              >{testStatus.testing ? '测试中…' : '测试连接'}</button>
              {testStatus.result && (
                <span style={{ fontSize: 11, color: testStatus.result.success ? 'var(--green, #22a863)' : 'var(--red, #f06a6a)' }}>
                  {testStatus.result.message}
                </span>
              )}
            </div>
            <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5 mt-4">
              <div className="text-[17px] shrink-0 mt-px">💡</div>
              <div>
                <h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">使用说明</h4>
                <p className="text-[11px] text-t3 leading-normal m-0">AI 工具通过调用本地 CLI（如 Claude Code）来编辑文档。请确保已安装对应的 CLI 工具。修改会以 Diff 形式展示，确认后再应用到文件。</p>
              </div>
            </div>
            {/* -- Chat 模式（rig 直连 LLM）-- */}
            <div className="mt-5 pt-4 border-t border-brd2">
              <div className="text-[length:calc(var(--ui-font-size)-1px)] font-bold text-t1 mb-[3px]">Chat 模式</div>
              <div className="text-[length:calc(var(--ui-font-size)-2px)] text-t3 mb-3">多轮对话，经 rig 直连 LLM（不经过 CLI，无工具/文件访问）。ask/agent 仍用上面的 CLI。</div>
              <div className="mb-3.5">
                <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">Provider</div>
                <select
                  className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={chatProvider}
                  onChange={(e) => setChatProvider(e.target.value as 'anthropic' | 'openai' | 'openai-compatible')}
                >
                  <option value="anthropic">Anthropic（Claude）</option>
                  <option value="openai">OpenAI</option>
                  <option value="openai-compatible">OpenAI 兼容（自定义 baseUrl）</option>
                </select>
              </div>
              <div className="mb-3.5">
                <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">模型</div>
                <input
                  className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={chatModel}
                  onChange={(e) => setChatModel(e.target.value)}
                  placeholder={chatProvider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-5.2'}
                  autoCapitalize="off"
                />
              </div>
              <div className="mb-3.5">
                <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">API Key</div>
                <div className="relative">
                  <input
                    type={showChatKey ? 'text' : 'password'}
                    className="fi2 w-full py-[7px] px-2.5 pr-[34px] rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                    value={chatApiKey}
                    onChange={(e) => setChatApiKey(e.target.value)}
                    placeholder="sk-…"
                    autoCapitalize="off"
                    autoComplete="off"
                  />
                  <button
                    type="button"
                    aria-label={showChatKey ? '隐藏 API Key' : '显示 API Key'}
                    title={showChatKey ? '隐藏 API Key' : '显示 API Key'}
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-[26px] h-[26px] flex items-center justify-center rounded bg-transparent border-none text-t3 cursor-pointer hover:bg-hov hover:text-t1"
                    onClick={() => setShowChatKey((v) => !v)}
                  >
                    {showChatKey ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
              <div className="mb-1">
                <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">Base URL（可选）</div>
                <input
                  className="fi2 w-full py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
                  value={chatBaseUrl}
                  onChange={(e) => setChatBaseUrl(e.target.value)}
                  placeholder={chatProvider === 'openai-compatible' ? 'http://localhost:11434/v1' : '留空用默认'}
                  autoCapitalize="off"
                />
                <div className="text-[10.5px] text-t3 mt-1">{chatProvider === 'anthropic' ? '官方 Anthropic 留空；Anthropic 兼容端点' : chatProvider === 'openai' ? '官方 OpenAI 留空。' : 'Ollama / vLLM / LM Studio 等必填；不以 /v1 结尾时会自动补 /v1。'}</div>
              </div>
              <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginTop: 8 }}>
                <button
                  className="btn btn-g btn-sm"
                  disabled={chatTestStatus.testing || !chatApiKey}
                  onClick={async () => {
                    setChatTestStatus({ testing: true });
                    try {
                      const result = await testChatConnection({
                        provider: chatProvider,
                        model: chatModel || (chatProvider === 'anthropic' ? 'claude-sonnet-4-6' : 'gpt-4o-mini'),
                        apiKey: chatApiKey,
                        baseUrl: chatBaseUrl || undefined,
                      });
                      setChatTestStatus({ testing: false, result });
                      setTimeout(() => setChatTestStatus((s) => ({ ...s, result: undefined })), 6000);
                    } catch (err) {
                      setChatTestStatus({ testing: false, result: { success: false, message: String(err) } });
                      setTimeout(() => setChatTestStatus((s) => ({ ...s, result: undefined })), 6000);
                    }
                  }}
                >{chatTestStatus.testing ? '测试中…' : '测试连接'}</button>
                {chatTestStatus.result && (
                  <span style={{ fontSize: 11, color: chatTestStatus.result.success ? 'var(--green, #22a863)' : 'var(--red, #f06a6a)' }}>
                    {chatTestStatus.result.success ? '✓ ' : '✗ '}{chatTestStatus.result.message}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* -- 文件模板 -- */}
        {/* -- 语音输入 -- */}
        {settingsTab === 'voice' && (
          <VoiceSettings />
        )}

        {settingsTab === 'templates' && (
          <FileTemplatesSettings />
        )}

        {/* -- Skills -- */}
        {settingsTab === 'skills' && (
          <SkillsSettings />
        )}

        {/* -- 桌宠 -- */}
        {settingsTab === 'pet' && (
          <PetSettings />
        )}

        {/* -- 通知 -- */}
        {settingsTab === 'notifications' && (
          <NotificationsSettings />
        )}

        {/* -- 插件 -- */}
        {settingsTab === 'plugins' && (
          <PluginsSettings />
        )}

        {/* -- 关于 -- */}
        {settingsTab === 'about' && (
          <div className="mb-[26px]">
            <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginBottom: 16 }}>
              <img src={`${import.meta.env.BASE_URL}quill.svg`} alt="Quill" width="48" height="48" style={{ borderRadius: 5 }} />
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--t1)', letterSpacing: '-.02em' }}>Quill<span style={{ color: 'var(--acc)' }}>.</span></div>
                <div style={{ fontSize: 11, color: 'var(--t3)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>v0.1.0-alpha · Local-first Markdown Editor</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 16 }}>
              <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5"><div className="text-[17px] shrink-0 mt-px">🏠</div><div><h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">本地优先</h4><p className="text-[11px] text-t3 leading-normal m-0">数据存储在你的设备上</p></div></div>
              <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5"><div className="text-[17px] shrink-0 mt-px">🔓</div><div><h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">开放格式</h4><p className="text-[11px] text-t3 leading-normal m-0">标准 Markdown，无锁定</p></div></div>
              <div className="info-c bg-surf2 border border-brd2 rounded-lg py-3 px-3.5 flex gap-2.5"><div className="text-[17px] shrink-0 mt-px">✦</div><div><h4 className="text-[12.5px] font-semibold text-t1 m-0 mb-0.5">AI 辅助</h4><p className="text-[11px] text-t3 leading-normal m-0">本地 + 云端 LLM</p></div></div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}><button className="btn btn-g btn-sm">📋 复制版本信息</button><button className="btn btn-g btn-sm">🔄 检查更新</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
