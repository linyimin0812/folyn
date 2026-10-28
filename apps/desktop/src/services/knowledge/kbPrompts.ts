/**
 * 知识库各模型调用的 prompt 构造（中文）。
 *
 * 模型只输出 JSON 提议；行号、锚文本、目标文件版本由程序校验后才写入
 * （ADR-0006「模型提议、程序写入」）。
 */

const JSON_ONLY = '只输出一个 JSON 对象，不要输出其他文字，不要使用 Markdown 代码围栏。';

export const KB_INDEX_PREAMBLE = `你是资料索引编目员。你的任务是阅读一份资料的一个片段，为它建立结构索引。
要求：
- 优先使用资料已有的标题/章节结构；无标题或章节过长时，提出语义分段。
- 每个节点必须对应真实、可核验的原文行号范围，行号是整份文件的绝对行号（1 开始，含端点）。
- 不改写原文，只描述它。
- 不要逐行列举原文内容（不要出现「第 N 行：……」式的罗列）；直接基于标题结构与段落主题概括出节点。
- 思考过程从简，不要在内部推理中复述原文；把输出预算留给 JSON 本身。
${JSON_ONLY}`;

export function kbIndexPrompt(chunkText: string, chunkFirstLine: number): string {
  return [
    `本片段从文件第 ${chunkFirstLine} 行开始。请为整个片段输出结构索引。`,
    '输出格式：',
    '{"nodes":[{"title":"节点标题","summary":"1-2 句摘要","startLine":12,"endLine":40}]}',
    '节点按 startLine 升序、范围不重叠、合并覆盖整个片段（允许 3-15 个节点）。',
    '',
    '## 片段内容（行号从 ' + chunkFirstLine + ' 开始）',
    chunkText,
  ].join('\n');
}

export const KB_SYNTH_PREAMBLE = `你是主题知识页的共同维护者。根据资料内容，为知识库提出主题页内容。
要求：
- 主题服务于知识库目标，不要为顺带提及的概念单独建页。
- 每个结论（claim）必须给出原文行号范围和一段原文锚文本（anchorText，逐字摘自该行范围）。
- 新知识新建主题页（mode:"new"）；补充已有主题用 mode:"append" 并给出已有主题的准确标题。
- 正文按知识内容组织，不写"更新于某日期"之类的小节。
- 引用待核验等状态由程序维护，你不要编造状态字段。
${JSON_ONLY}`;

export function kbSynthPrompt(
  goal: string,
  sourcePath: string,
  indexSummary: string,
  chunkText: string,
  chunkFirstLine: number,
  existingTopics: { title: string }[],
): string {
  return [
    '## 知识库目标',
    goal || '（未声明）',
    '',
    '## 本份资料',
    `路径：${sourcePath}`,
    '',
    '## 资料结构索引',
    indexSummary,
    '',
    existingTopics.length > 0
      ? ['## 已有主题（append 时 title 必须与其中一项完全一致）', ...existingTopics.map((t) => `- ${t.title}`)].join('\n')
      : '## 已有主题（无，全部建议 mode:"new"）',
    '',
    `## 资料片段（从第 ${chunkFirstLine} 行开始，行号是整份文件的绝对行号）`,
    chunkText,
    '',
    '输出格式：',
    '{"topics":[{"title":"主题标题","mode":"new","sections":[{"heading":"章节标题","body":"章节导语（可以引用原文观点，用你自己的话组织）","claims":[{"text":"结论句子","anchorText":"原文锚文本","startLine":12,"endLine":18}]}]}]}',
  ].join('\n');
}

export const KB_RETRIEVAL_PREAMBLE = `你是知识库检索调度器。你的任务是针对用户问题，逐轮选择一个检索动作，直到证据足够或无法继续。
可用动作（每轮只返回一个）：
- {"action":"list_topics"} — 列出全部主题与关联资料
- {"action":"open_topic","args":{"tpId":"tp-xxx"}} — 阅读一个主题知识页
- {"action":"search","args":{"query":"关键词"}} — 关键词搜索（支持中英文）
- {"action":"read_source","args":{"srcId":"src-xxx","startLine":1,"endLine":50}} — 按行读取原始资料
- {"action":"done"} — 证据已足够，结束检索
规则：
- 依据已读到的观测继续决策；先用 search 或 list_topics 定位，再 open_topic / read_source 取证。
- read_source 的行范围可用可不用，缺省读文件开头。
- 证据足够回答问题就 done；找不到就尝试别的搜索词，最多几轮后 done。
${JSON_ONLY}`;

export function kbRetrievalPrompt(question: string, history: string[]): string {
  return [
    `## 用户问题\n${question}`,
    '',
    '## 已执行的动作与观测',
    ...(history.length > 0 ? history.map((h, i) => `[${i + 1}] ${h}`) : ['（尚无，这是第一轮）']),
    '',
    '请返回下一个动作的 JSON。',
  ].join('\n');
}

export const KB_ANSWER_PREAMBLE = `你是知识库问答的回答层。你会收到一组带来源、版本与行号的结构化证据。
要求：
- 只依据证据回答；证据不足以支持的部分明确说明"证据中没有"。
- 引用结论时标注来源路径与行号范围（如 path.md L12-L18）。
- 如证据带有状态标记（如来源已移除、版本不一致），如实转述，不要自行给出置信度评分。
- 会话上下文只用于理解当前问题的指代与承接，不要把其中旧回答当作证据复述。
- 用中文回答，简洁分段。`;

/** 回答层注入的会话上下文轮数上限（检索仍只按当前问题）。 */
export const KB_MAX_HISTORY_TURNS = 6;

export function kbAnswerPrompt(
  question: string,
  evidenceBlocks: string,
  gaps: string,
  history: { question: string; answer: string }[] = [],
): string {
  const prior = history.slice(-KB_MAX_HISTORY_TURNS);
  return [
    ...(prior.length > 0
      ? [
        '## 会话上下文（此前问答，仅供承接理解；检索与证据仍只针对当前问题）',
        ...prior.map((t) => `问：${t.question}\n答：${t.answer}`),
        '',
      ]
      : []),
    `## 用户问题\n${question}`,
    '',
    '## 检索证据',
    evidenceBlocks || '（无证据）',
    gaps ? `\n## 检索缺口\n${gaps}` : '',
    '',
    '请回答用户问题。',
  ]
    .filter(Boolean)
    .join('\n');
}

export const KB_VERIFY_PREAMBLE = `你是引用核验员。判断给出的原文摘录是否支持知识页中的说法。
要求：
- 只检查原文是否支持该说法，不判定该说法本身是否真实可靠（ADR-0007：核验与事实可靠性区分）。
- 如实给出理由；证据不足时判为不支持并说明缺口。
${JSON_ONLY}`;

export function kbVerifyPrompt(claim: string, anchorText: string, excerpt: string): string {
  return [
    '## 知识页中的说法（可能已被人工修改）',
    claim,
    '',
    '## 引用记录的原文锚文本',
    anchorText,
    '',
    '## 原文摘录（引用时版本）',
    excerpt || '（空）',
    '',
    '输出格式：',
    '{"supported":true,"reason":"1-2 句理由"}',
  ].join('\n');
}
