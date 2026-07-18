import { useState, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSkillStore } from '@/store/skillStore';
import { builtinSkills } from '@/services/skillDefaults';
import type { SkillOutputFormat, SkillCapability } from '@/types/skill';
import { isTauri } from '@/utils/platform';

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

export function SkillsSettings() {
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
    return name.toLowerCase().replace(/[^a-z0-9一-鿿]+/g, '-').replace(/^-+|-+$/g, '');
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
              className="fi2 w-full py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
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
              className="fi2 w-full py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
              value={newName}
              onChange={(e) => { setNewName(e.target.value); if (!newId) setNewId(slugify(e.target.value)); }}
              placeholder="My Custom Skill"
            />
          </div>
          <div className="mb-2.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">描述</div>
            <input
              className="fi2 w-full py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="描述此 Skill 的用途"
            />
          </div>
          <div className="mb-2.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">Prompt 模板</div>
            <textarea
              className="w-full py-2 px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
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
              className="fi2 w-full py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>

          {/* Description */}
          <div className="mb-2.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">描述</div>
            <input
              className="fi2 w-full py-[5px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          {/* Skill Content */}
          <div className="mb-2.5">
            <div className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2 mb-[5px]">Skill 内容</div>
            <textarea
              className="w-full py-2 px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui transition-[border-color] duration-100 focus:border-acc"
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
