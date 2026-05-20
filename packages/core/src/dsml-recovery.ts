/**
 * DSML 信封打捞(route Y / Bug A 解析层兜底)
 *
 * 见 `docs/plans/2026-05-20-dsml-recovery.md` 与 ledger §8
 * `patchloop-dsml-content-leak`。
 *
 * 当模型把合法 change block(`<PATCH>` / `<CREATE>` / `<RENAME/>` / `<DELETE/>` /
 * `<INSERT>` / `<PATCH type="search">`)塞进 DeepSeek 原生 DSML 工具调用的
 * `<｜DSML｜parameter>`,而 API 因 hallucinated tool name 或畸形 DSML token
 * 未能把它兑现成结构化 `tool_calls` 时,DSML 信封碎片会泄漏进 `message.content`,
 * 内层 change 块的闭标签被 `</｜｜DSML｜｜parameter>` 替换。本模块识别该泄漏并
 * 打捞 change 块,使下游 `parsePatchTurn` / `parseChanges` 能正确解析。
 *
 * 实测的畸形 token 是双全角竖线 `<｜｜DSML｜｜...>`(U+FF5C ×2),官方规范是单竖线
 * `<｜DSML｜...>`;regex 同时覆盖两种形态。
 *
 * 本模块不替代 route X(Phase 4,见 `docs/specs/2026-05-20-edits-as-native-tool.md`)
 * —— 即使将来把编辑迁到原生工具通道,模型仍可能吐畸形 DSML,salvage 仍是底座。
 */

/**
 * 完整的 DSML 标签(开或闭、单或双竖线、任意属性)。
 * U+FF5C = 全角竖线 `｜`。
 */
const DSML_TAG_RE = /<\/?｜｜?DSML｜｜?[^>]*>/g;

/** 仅判定是否含 DSML 泄漏标志(开或闭) */
const DSML_PRESENCE_RE = /<\/?｜｜?DSML｜｜?/;

/**
 * 需要配对闭标签的 change 块。`<RENAME .../>` 与 `<DELETE .../>` 是自闭合,
 * 不在此处;`<PATCH type="search" ...>` 与无属性的 `<PATCH>` 共用 `</PATCH>` 闭标签,
 * 单条规则覆盖即可。
 */
const PAIRED_BLOCKS = [
  { name: "PATCH", openRe: /<PATCH(?:\s[^>]*)?>/g, close: "</PATCH>" },
  { name: "CREATE", openRe: /<CREATE\s[^>]*>/g, close: "</CREATE>" },
  { name: "INSERT", openRe: /<INSERT\s[^>]*>/g, close: "</INSERT>" },
] as const;

export interface DsmlRecoveryResult {
  /** true = 内容里检测到 DSML 标志并已 strip(可能也合成了闭标签);false = 原样 passthrough */
  recovered: boolean;
  /** 修正后或原样的内容 */
  content: string;
  /** 人类可读的处理说明,仅 recovered=true 时有值 */
  reason?: string;
}

/**
 * 检测并打捞泄漏进 content 的 DSML 包裹 change 块。
 *
 * 行为:
 * 1. 不含 DSML 标志 → `recovered: false`,passthrough。
 * 2. 命中 → 剥离所有 `<\/?｜｜?DSML｜｜?...>` 标签。
 * 3. 对每种需要配对闭标签的 change 块,若开标签数 > 闭标签数,在内容末尾补齐
 *    缺失的闭标签(模型一轮发一个 change 块是 DSH 协议要求,补在末尾足以应付
 *    主线场景;多块场景由 `parsePatchTurn` 的「multiple change blocks」分支兜底)。
 * 4. 返回修正后的内容,交给 `parsePatchTurn` / `parseChanges` 走常规路径。
 */
export function recoverDsmlWrappedChange(content: string): DsmlRecoveryResult {
  if (!DSML_PRESENCE_RE.test(content)) {
    return { recovered: false, content };
  }

  // 1. Strip every DSML tag (single- or double-bar, opening or closing)
  let stripped = content.replace(DSML_TAG_RE, "");

  // 2. Synthesize missing close tags for paired change blocks
  const synthesized: string[] = [];
  for (const { name, openRe, close } of PAIRED_BLOCKS) {
    const opens = (stripped.match(openRe) ?? []).length;
    if (opens === 0) continue;
    const closes = countOccurrences(stripped, close);
    const missing = opens - closes;
    if (missing > 0) {
      stripped =
        stripped.trimEnd() + "\n" + Array(missing).fill(close).join("\n");
      synthesized.push(`${name}×${missing}`);
    }
  }

  return {
    recovered: true,
    content: stripped,
    reason:
      synthesized.length > 0
        ? `stripped DSML envelope; synthesized close: ${synthesized.join(", ")}`
        : "stripped DSML envelope (no synthesis needed)",
  };
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}
