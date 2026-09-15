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
        <svg width="16" height="16" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', flexShrink: 0 }}>
          <path fillRule="evenodd" clipRule="evenodd" d="M16 0C7.16 0 0 7.16 0 16C0 23.08 4.58 29.06 10.94 31.18C11.74 31.32 12.04 30.84 12.04 30.42C12.04 30.04 12.02 28.78 12.02 27.44C8 28.18 6.96 26.46 6.64 25.56C6.46 25.1 5.68 23.68 5 23.3C4.44 23 3.64 22.26 4.98 22.24C6.24 22.22 7.14 23.4 7.44 23.88C8.88 26.3 11.18 25.62 12.1 25.2C12.24 24.16 12.66 23.46 13.12 23.06C9.56 22.66 5.84 21.28 5.84 15.16C5.84 13.42 6.46 11.98 7.48 10.86C7.32 10.46 6.76 8.82 7.64 6.62C7.64 6.62 8.98 6.2 12.04 8.26C13.32 7.9 14.68 7.72 16.04 7.72C17.4 7.72 18.76 7.9 20.04 8.26C23.1 6.18 24.44 6.62 24.44 6.62C25.32 8.82 24.76 10.46 24.6 10.86C25.62 11.98 26.24 13.4 26.24 15.16C26.24 21.3 22.5 22.66 18.94 23.06C19.52 23.56 20.02 24.52 20.02 26.02C20.02 28.16 20 29.88 20 30.42C20 30.84 20.3 31.34 21.1 31.18C27.42 29.06 32 23.06 32 16C32 7.16 24.84 0 16 0V0Z" fill="currentColor"/>
        </svg>
        <div className="text-[13px] font-semibold text-t1">GitHub + jsDelivr</div>
      </div>
      <Field label="GitHub 账户 (Owner)" value={draft.owner} onChange={(v) => set({ owner: v })} placeholder="your-name" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="仓库 (Repository)" value={draft.repo} onChange={(v) => set({ repo: v })} placeholder="images" />
        <Field label="分支 (Branch)" value={draft.branch} onChange={(v) => set({ branch: v })} placeholder="main" />
      </div>
      <Field label="访问令牌 (Token)" value={draft.token} onChange={(v) => set({ token: v })} type="password" placeholder="ghp_… / github_pat_…" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="图片路径前缀" value={draft.imageKeyPrefix} onChange={(v) => set({ imageKeyPrefix: v })} placeholder="images/" />
        <Field label="HTML 路径前缀" value={draft.htmlKeyPrefix} onChange={(v) => set({ htmlKeyPrefix: v })} placeholder="html/" />
      </div>
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
                htmlKeyPrefix: draft.htmlKeyPrefix.trim() || 'html/',
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
        <li className="flex gap-1.5"><span className="shrink-0 text-t3/70">•</span><span>图片走 jsDelivr CDN：<code>https://cdn.jsdelivr.net/gh/&lt;owner&gt;/&lt;repo&gt;@&lt;branch&gt;/&lt;prefix&gt;/&lt;hash&gt;.png</code>。仓库需为公开仓库，jsDelivr 才能公开缓存。</span></li>
        <li className="flex gap-1.5"><span className="shrink-0 text-t3/70">•</span><span>导出的 HTML 走 GitHub Pages：<code>https://&lt;owner&gt;.github.io/&lt;repo&gt;/&lt;prefix&gt;/&lt;hash&gt;.html</code>。<b>需在仓库 Settings → Pages 手动开启</b>，分支与上方配置一致、源选根目录（root）。首次开启后 Pages 构建需约 1 分钟才生效。</span></li>
        <li className="flex gap-1.5"><span className="shrink-0 text-t3/70">•</span><span>相同内容（相同哈希）重复上传会跳过，URL 不变。</span></li>
      </ul>
    </div>
  );
}
