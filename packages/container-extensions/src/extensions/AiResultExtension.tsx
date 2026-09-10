import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

function AiResultComponent({ children }: ContainerProps) {
  return (
    <div style={{ padding: '16px', background: 'linear-gradient(135deg, var(--accdim, #dce8ff), var(--surf, #f8f9fd))', borderRadius: '8px', border: '1px solid var(--brd2, #c8d0e8)', margin: '12px 0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', fontSize: '12px', fontWeight: 600, color: 'var(--acc, #3a6ef0)' }}>
        ✦ AI 生成内容
      </div>
      <div>{children}</div>
    </div>
  );
}

export const aiResultExtension: ContainerExtension = {
  name: 'ai-result',
  icon: '✦',
  label: 'AI 结果',
  category: 'ai',
  component: AiResultComponent,
  template: ':::ai-result\nAI 生成的内容将显示在这里\n:::',
  description: 'AI 生成内容展示与 diff 审阅',
};
