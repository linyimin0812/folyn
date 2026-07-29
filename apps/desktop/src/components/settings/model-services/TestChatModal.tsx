import { useTranslation } from 'react-i18next';
import { testChatConnection } from '@/services/rigChat';
import type { CustomProviderDef } from '@/services/providers/providerConfigStorage';

export type ChatTestStatus = {
  testing: boolean;
  result?: { success: boolean; message: string };
};

interface TestChatModalProps {
  open: boolean;
  onClose: () => void;
  status: ChatTestStatus;
  setStatus: (s: ChatTestStatus) => void;
  testModelId: string;
  setTestModelId: (id: string) => void;
  chatProvider: string;
  chatModel: string;
  chatApiKey: string;
  chatBaseUrl: string;
  chatAzureDeploymentId: string;
  chatAzureApiVersion: string;
  isCustom: boolean;
  customerProviders: Record<string, CustomProviderDef>;
  placeholderModel: string;
  selectedModelIds: string[];
}

export function TestChatModal({
  open,
  onClose,
  status,
  setStatus,
  testModelId,
  setTestModelId,
  chatProvider,
  chatModel,
  chatApiKey,
  chatBaseUrl,
  chatAzureDeploymentId,
  chatAzureApiVersion,
  isCustom,
  customerProviders,
  placeholderModel,
  selectedModelIds,
}: TestChatModalProps) {
  const { t } = useTranslation();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center"
      onClick={() => !status.testing && onClose()}
    >
      <div
        className="bg-panel border border-brd rounded-md w-[400px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 pt-4 pb-2">
          <div className="text-[length:calc(var(--ui-font-size)+1px)] font-bold text-t1">
            {t('settings:models.test.label')}
          </div>
        </div>
        <div className="h-px bg-brd mx-4" />
        <div className="px-4 py-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[length:calc(var(--ui-font-size)-2.5px)] font-semibold text-t2">
              {t('settings:models.test.selectModel') || 'Select model'}
            </span>
            <select
              className="fi2 h-[34px] py-[7px] px-2.5 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui"
              value={testModelId}
              onChange={(e) => setTestModelId(e.target.value)}
            >
              {/* ponytail: chatModel (manually-added, not in selectedModelIds)
                  leads the dropdown so the user sees what they're testing. */}
              {(chatModel && !selectedModelIds.includes(chatModel)
                ? [chatModel, ...selectedModelIds]
                : selectedModelIds
              ).map((mid) => (
                <option key={mid} value={mid}>{mid}</option>
              ))}
            </select>
          </label>
          {status.result && (
            <div className="break-words max-h-[120px] overflow-y-auto" style={{ fontSize: 11, color: status.result.success ? 'var(--green, #22a863)' : 'var(--red, #f06a6a)' }}>
              {status.result.success ? '✓ ' : '✗ '}{status.result.message}
            </div>
          )}
        </div>
        <div className="h-px bg-brd mx-4" />
        <div className="flex justify-end gap-2 px-4 py-3">
          <button
            className="btn btn-g btn-sm"
            disabled={status.testing}
            onClick={onClose}
          >
            {t('settings:models.cancel')}
          </button>
          <button
            className="btn btn-p btn-sm"
            disabled={status.testing || !testModelId}
            onClick={async () => {
              setStatus({ testing: true });
              try {
                // ponytail: custom providers route via chat.rs `_` fallback arm.
                const result = await testChatConnection({
                  provider: chatProvider,
                  model: testModelId || placeholderModel,
                  apiKey: chatApiKey,
                  baseUrl: chatBaseUrl || undefined,
                  azureDeploymentId: chatAzureDeploymentId || undefined,
                  azureApiVersion: chatAzureApiVersion || undefined,
                  // PR2e: route custom providers via endpoint resolver.
                  customProvider: isCustom,
                  defaultChatEndpoint: isCustom ? (customerProviders[chatProvider]?.defaultChatEndpoint) : undefined,
                });
                setStatus({ testing: false, result });
              } catch (err) {
                setStatus({ testing: false, result: { success: false, message: String(err) } });
              }
            }}
          >
            {status.testing ? t('settings:models.test.testing') : t('settings:models.test.label')}
          </button>
        </div>
      </div>
    </div>
  );
}
