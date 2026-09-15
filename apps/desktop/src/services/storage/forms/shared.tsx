/**
 * Shared form primitives for built-in storage-provider config forms.
 * Extension-contributed forms bring their own UI; these are just the
 * built-ins' common field + hint rows, kept here so each form file stays
 * focused on its own fields.
 */
import { useTranslation } from 'react-i18next';

export function Field({ label, value, onChange, placeholder, type = 'text' }: {
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

export function Hint({ i18nKey }: { i18nKey: string }) {
  const { t } = useTranslation();
  const text = t(i18nKey);
  const parts = text.split('\n').filter((s) => s.trim().length > 0);
  if (parts.length === 0) return null;
  return (
    <ul className="text-[11px] text-t3 mt-3 leading-relaxed space-y-1.5">
      {parts.map((p, i) => (
        <li key={i} className="flex gap-1.5">
          <span className="shrink-0 text-t3/70">•</span>
          <span>{p}</span>
        </li>
      ))}
    </ul>
  );
}
