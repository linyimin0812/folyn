import { useTranslation } from 'react-i18next';
import type { CustomProviderDef } from '@/services/providers/providerConfigStorage';

interface DeleteProviderConfirmDialogProps {
  provider: CustomProviderDef;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteProviderConfirmDialog({
  provider,
  onCancel,
  onConfirm,
}: DeleteProviderConfirmDialogProps) {
  const { t } = useTranslation();

  return (
    <div className="fixed inset-0 z-[9999] bg-black/35 flex items-center justify-center" onClick={onCancel}>
      <div className="bg-panel rounded-[10px] py-5 px-6 min-w-[300px] max-w-[400px] shadow-[0_8px_32px_rgba(0,0,0,0.18)] border border-brd" onClick={(e) => e.stopPropagation()}>
        <div className="text-[15px] font-semibold text-t1 mb-2">{t('settings:models.confirmDelete')}</div>
        <div className="text-[13px] text-t2 leading-relaxed mb-4">
          <strong>{provider.name || provider.id}</strong>
        </div>
        <div className="flex justify-end gap-2">
          <button className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-brd font-ui transition-all duration-[140ms] bg-panel text-t2 hover:bg-hov" onClick={onCancel}>{t('settings:models.cancel')}</button>
          <button
            className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-[#e74c3c] font-ui transition-all duration-[140ms] bg-[#e74c3c] text-white hover:bg-[#c0392b] hover:border-[#c0392b]"
            onClick={onConfirm}
          >
            {t('settings:models.deleteCustom')}
          </button>
        </div>
      </div>
    </div>
  );
}
