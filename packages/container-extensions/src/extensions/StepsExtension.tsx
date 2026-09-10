import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

/** Single step – renders title + content, number via CSS counter */
function StepComponent({ children, attributes }: ContainerProps) {
  const title = attributes?.title || attributes?.label || '';

  return (
    <div className="docmd-step">
      <span className="docmd-step-number" />
      {title && (
        <div style={{ fontWeight: 600, marginBottom: '0.25rem', color: 'var(--t1, #18181b)' }}>
          {title}
        </div>
      )}
      <div style={{ lineHeight: 1.7, color: 'var(--t2, #3f3f46)' }}>
        {children}
      </div>
    </div>
  );
}

/** Steps container – layout wrapper with vertical connector line and CSS counter reset */
function StepsComponent({ children }: ContainerProps) {
  return (
    <div className="docmd-steps">
      <div className="docmd-steps-line" />
      {children}
    </div>
  );
}

export const stepExtension: ContainerExtension = {
  name: 'step',
  icon: '🔢',
  label: '步骤项',
  category: 'layout',
  component: StepComponent,
  template: ':::step{title="步骤标题"}\n步骤内容\n:::',
  description: '单个步骤（用在 ::::steps 内部）',
};

export const stepsExtension: ContainerExtension = {
  name: 'steps',
  icon: '📋',
  label: '步骤',
  category: 'layout',
  component: StepsComponent,
  template: '::::steps\n:::step{title="准备工作"}\n安装依赖和配置环境\n:::\n:::step{title="开始实施"}\n编写核心代码\n:::\n:::step{title="完成验证"}\n运行测试确认结果\n:::\n::::',
  description: '编号步骤时间线',
};
