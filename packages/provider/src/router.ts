export interface RouteTarget {
  model: string;
  thinking: boolean;
}

export interface ModelRoutingConfig {
  planModel?: string;
  patchSmallModel?: string;
  patchLargeModel?: string;
  verifyModel?: string;
  repairModel?: string;
  handoffModel?: string;
  initScanModel?: string;
  initRuleDetectModel?: string;
}

export type CommandName =
  | "plan"
  | "patch"
  | "verify"
  | "repair"
  | "handoff"
  | "init/scan"
  | "init/rule-detect";

export interface ClassifyInput {
  command: CommandName;
  taskType?: string;
  fileCount?: number;
}

const DEFAULT_PRO = "deepseek-v4-pro";
const DEFAULT_FLASH = "deepseek-v4-flash";

function routes(config: ModelRoutingConfig = {}): Record<CommandName, RouteTarget> {
  return {
    "plan": { model: config.planModel ?? DEFAULT_PRO, thinking: true },
    "patch": { model: config.patchSmallModel ?? DEFAULT_FLASH, thinking: true },
    "verify": { model: config.verifyModel ?? DEFAULT_FLASH, thinking: false },
    "repair": { model: config.repairModel ?? DEFAULT_PRO, thinking: true },
    "handoff": { model: config.handoffModel ?? DEFAULT_FLASH, thinking: false },
    "init/scan": { model: config.initScanModel ?? DEFAULT_FLASH, thinking: false },
    "init/rule-detect": { model: config.initRuleDetectModel ?? DEFAULT_PRO, thinking: true },
  };
}
/**
 * 根据命令和输入参数路由到合适的模型。
 *
 * @param input - 包含命令、任务类型和文件数的输入对象
 * @param input.command - 要执行的命令名称
 * @param input.taskType - （可选）任务类型
 * @param input.fileCount - （可选）涉及的文件数量，仅对 patch 命令生效
 * @returns 包含模型名称和是否启用思考模式的路由目标
 *
 * **patch 特殊逻辑**：当 command 为 "patch" 且 fileCount > 3 时，强制路由到 Pro 模型（默认 Flash）。
 */
export function classify(input: ClassifyInput, config: ModelRoutingConfig = {}): RouteTarget {
  // patch 命令根据文件数决定模型
  if (input.command === "patch" && input.fileCount && input.fileCount > 3) {
    return { model: config.patchLargeModel ?? DEFAULT_PRO, thinking: true };
  }
  return routes(config)[input.command];
}
