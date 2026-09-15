/**
 * Config form for the GitHub + jsDelivr storage provider, rendered in
 * Settings → Storage & Sharing. Owns its draft state; narrows the opaque
 * saved config to {@link GithubJsdelivrConfig}. Hardcoded bilingual labels
 * (no i18n bundle — YAGNI for a 5-field form).
 */
import { useState, useRef, useEffect } from 'react';
import type { StorageConfigFormProps } from 'folyn-extension-sdk';
import type { GithubJsdelivrConfig } from './config';
import { defaultConfig } from './config';

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
}) {
  return (
    <div className="mb-3">
      <label className="block text-xs text-t3 mb-1 font-medium">{label}</label>
      <input
        type={type}
        className="w-full py-[6px] px-2.5 border border-brd2 rounded-md bg-surf text-t1 text-[13px] outline-none focus:border-acc focus:shadow-[0_0_0_2px_var(--accdim)]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoCapitalize="off"
        autoComplete="off"
      />
    </div>
  );
}

export function GithubJsdelivrForm({ config, onSave, onRemove }: StorageConfigFormProps) {
  const initial = { ...defaultConfig(), ...((config as Partial<GithubJsdelivrConfig> | null) ?? {}) };
  const [draft, setDraft] = useState<GithubJsdelivrConfig>(initial);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (patch: Partial<GithubJsdelivrConfig>) => setDraft((d) => ({ ...d, ...patch }));

  useEffect(() => () => {
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
  }, []);

  return (
    <div className="p-4 border border-brd2 rounded-lg bg-surf">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[16px] leading-none">🐙</span>
        <div className="text-[13px] font-semibold text-t1">GitHub + jsDelivr</div>
      </div>
      <Field label="GitHub 账户 (Owner)" value={draft.owner} onChange={(v) => set({ owner: v })} placeholder="your-name" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="仓库 (Repository)" value={draft.repo} onChange={(v) => set({ repo: v })} placeholder="images" />
        <Field label="分支 (Branch)" value={draft.branch} onChange={(v) => set({ branch: v })} placeholder="main" />
      </div>
      <Field label="访问令牌 (Token)" value={draft.token} onChange={(v) => set({ token: v })} type="password" placeholder="ghp_… / github_pat_…" />
      <Field label="图片路径前缀" value={draft.imageKeyPrefix} onChange={(v) => set({ imageKeyPrefix: v })} placeholder="images/" />
      <div className="flex gap-2 mt-3">
        <button
          className="py-[7px] px-[18px] rounded-md text-[13px] font-medium cursor-pointer border-none bg-acc text-white hover:brightness-110 disabled:opacity-50"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            try {
              await onSave({
                ...draft,
                owner: draft.owner.trim(),
                repo: draft.repo.trim(),
                branch: draft.branch.trim() || 'main',
                token: draft.token.trim(),
                imageKeyPrefix: draft.imageKeyPrefix.trim() || 'images/',
              });
              setSavedAt(Date.now());
              if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
              savedTimerRef.current = setTimeout(() => setSavedAt(null), 2500);
            } finally { setSaving(false); }
          }}
        >
          保存
        </button>
        <button
          className="py-[7px] px-[18px] rounded-md text-[13px] font-medium cursor-pointer border-none bg-surf2 text-t2 hover:bg-brd"
          onClick={() => onRemove()}
        >
          清除
        </button>
        {savedAt !== null && (
          <span className="self-center text-[11px] text-[var(--green,#22a863)]">✓ 已保存</span>
        )}
      </div>
      <ul className="text-[11px] text-t3 mt-3 leading-relaxed space-y-1.5">
        <li className="flex gap-1.5"><span className="shrink-0 text-t3/70">•</span><span>令牌需有目标仓库的 Contents: write 权限（经典 PAT 用 <code>repo</code> scope，或细粒度 PAT 授予该仓库的 Contents 读写）。</span></li>
        <li className="flex gap-1.5"><span className="shrink-0 text-t3/70">•</span><span>仓库需为公开仓库，jsDelivr 才能公开缓存；私有仓库的链接无法被外部访问。</span></li>
        <li className="flex gap-1.5"><span className="shrink-0 text-t3/70">•</span><span>图片通过 <code>https://cdn.jsdelivr.net/gh/&lt;owner&gt;/&lt;repo&gt;@&lt;branch&gt;/&lt;prefix&gt;/&lt;hash&gt;.png</code> 访问。同名图片（相同内容哈希）重复上传会跳过，URL 不变。</span></li>
      </ul>
    </div>
  );
}
