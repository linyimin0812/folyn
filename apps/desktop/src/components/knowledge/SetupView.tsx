import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { ArrowRight, BookOpen, FolderInput, Layers3 } from 'lucide-react';
import { BTN, BTN_PRIMARY } from './kbUi';
import { useThemeUiStore } from './themeUiStore';

export function SetupView(): React.JSX.Element {
  const { t } = useTranslation();
  const error = useKnowledgeStore((s) => s.buildError);
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try { await useKnowledgeStore.getState().loadFromManifest(); } finally { setRetrying(false); }
  };
  const setCreateOpen = useThemeUiStore((s) => s.setCreateOpen);
  return <div className="kb-onboarding">
    <div className="kb-onboarding-inner">{error && <div className="mb-6 flex flex-col gap-3 items-center"><p role="alert" className="kb-form-error">{error}</p><button className={BTN} disabled={retrying} onClick={() => void retry()}>{retrying ? t('knowledge:setup.retrying') : t('knowledge:setup.retry')}</button></div>}<span className="kb-onboarding-symbol"><Layers3 size={28} strokeWidth={1.3} /></span><div className="kb-eyebrow">{t('knowledge:setup.eyebrow')}</div><h1>{t('knowledge:setup.title')}</h1><p>{t('knowledge:setup.description')}</p><button className={BTN_PRIMARY} onClick={() => setCreateOpen(true)}>{t('knowledge:setup.createFirst')}<ArrowRight size={14} /></button>
      <div className="kb-onboarding-steps"><div><Layers3 size={17} strokeWidth={1.5} /><span>{t('knowledge:setup.steps.define.title')}</span><p>{t('knowledge:setup.steps.define.desc')}</p></div><div><FolderInput size={17} strokeWidth={1.5} /><span>{t('knowledge:setup.steps.add.title')}</span><p>{t('knowledge:setup.steps.add.desc')}</p></div><div><BookOpen size={17} strokeWidth={1.5} /><span>{t('knowledge:setup.steps.read.title')}</span><p>{t('knowledge:setup.steps.read.desc')}</p></div></div>
    </div>
  </div>;
}
