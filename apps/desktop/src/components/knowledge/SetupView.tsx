import { useState } from 'react';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { ArrowRight, BookOpen, FolderInput, Layers3 } from 'lucide-react';
import { BTN, BTN_PRIMARY } from './kbUi';
import { useThemeUiStore } from './themeUiStore';

export function SetupView(): React.JSX.Element {
  const error = useKnowledgeStore((s) => s.buildError);
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try { await useKnowledgeStore.getState().loadFromManifest(); } finally { setRetrying(false); }
  };
  const setCreateOpen = useThemeUiStore((s) => s.setCreateOpen);
  return <div className="kb-onboarding">
    <div className="kb-onboarding-inner">{error && <div className="mb-6 flex flex-col gap-3 items-center"><p role="alert" className="kb-form-error">{error}</p><button className={BTN} disabled={retrying} onClick={() => void retry()}>{retrying ? '正在重试…' : '重新读取主题'}</button></div>}<span className="kb-onboarding-symbol"><Layers3 size={28} strokeWidth={1.3} /></span><div className="kb-eyebrow">你的知识，按方向积累</div><h1>从一个主题开始</h1><p>把散落的资料整理成可阅读、可追溯的知识。为不同方向创建主题，资料与生成的知识各自独立。</p><button className={BTN_PRIMARY} onClick={() => setCreateOpen(true)}>创建第一个主题<ArrowRight size={14} /></button>
      <div className="kb-onboarding-steps"><div><Layers3 size={17} strokeWidth={1.5} /><span>定义主题</span><p>说明要积累什么</p></div><div><FolderInput size={17} strokeWidth={1.5} /><span>添加资料</span><p>选择文件或目录</p></div><div><BookOpen size={17} strokeWidth={1.5} /><span>阅读与追问</span><p>每一条知识都有依据</p></div></div>
    </div>
  </div>;
}
