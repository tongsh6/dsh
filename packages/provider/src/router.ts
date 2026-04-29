export interface RouteTarget {
  model: string;
  thinking: boolean;
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

const ROUTES: Record<CommandName, RouteTarget> = {
  "plan": { model: DEFAULT_PRO, thinking: true },
  "patch": { model: DEFAULT_FLASH, thinking: true },
  "verify": { model: DEFAULT_FLASH, thinking: false },
  "repair": { model: DEFAULT_PRO, thinking: true },
  "handoff": { model: DEFAULT_FLASH, thinking: false },
  "init/scan": { model: DEFAULT_FLASH, thinking: false },
  "init/rule-detect": { model: DEFAULT_PRO, thinking: true },
};
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
export function classify(input: ClassifyInput): RouteTarget {
  // patch 命令根据文件数决定模型
  if (input.command === "patch" && input.fileCount && input.fileCount > 3) {
    return { model: DEFAULT_PRO, thinking: true };
  }
  return ROUTES[input.command];
}
