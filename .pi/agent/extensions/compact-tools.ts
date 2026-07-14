import { isAbsolute, relative } from "node:path"
import {
  type AgentToolResult,
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ExtensionAPI,
  formatSize,
  type SessionEntry,
  type Theme,
  type ToolDefinition,
  type ToolRenderResultOptions,
} from "@earendil-works/pi-coding-agent"
import {
  type Component,
  Container,
  truncateToWidth,
} from "@earendil-works/pi-tui"
import type { TSchema } from "typebox"

type GroupKind = "read" | "bash" | "changes" | "list" | "find" | "grep"
type ItemStatus = "pending" | "success" | "error"
type ToolName = "read" | "bash" | "edit" | "write" | "ls" | "find" | "grep"
type ToolArguments = Record<string, unknown>
type GroupedRenderContext = {
  args: ToolArguments
  toolCallId: string
  lastComponent: Component | undefined
  isError: boolean
}
type ToolGroupItem = {
  toolCallId: string
  toolName: ToolName
  action?: string
  target: string
  metadata?: string
  status: ItemStatus
  error?: string
  group: ToolGroup
}
type ToolGroup = {
  id: number
  kind: GroupKind
  items: ToolGroupItem[]
}

const GROUP_LABELS: Record<GroupKind, string> = {
  read: "Read",
  bash: "Bash",
  changes: "Changes",
  list: "List",
  find: "Find",
  grep: "Grep",
}
const SUPPORTED_TOOLS = new Set<ToolName>([
  "read",
  "bash",
  "edit",
  "write",
  "ls",
  "find",
  "grep",
])

export default function compactToolsExtension(pi: ExtensionAPI) {
  let groups: ToolGroupManager | undefined

  pi.on("session_start", (_event, ctx) => {
    groups = new ToolGroupManager(ctx.cwd)
    groups.restore(ctx.sessionManager.getBranch())
    registerGroupedTools(pi, ctx.cwd, groups)
  })

  pi.on("before_agent_start", () => {
    groups?.breakGroup()
  })
}

function registerGroupedTools(
  pi: ExtensionAPI,
  cwd: string,
  groups: ToolGroupManager,
): void {
  pi.registerTool(groupedTool(createReadToolDefinition(cwd), "read", groups))
  pi.registerTool(groupedTool(createBashToolDefinition(cwd), "bash", groups))
  pi.registerTool(groupedTool(createEditToolDefinition(cwd), "edit", groups))
  pi.registerTool(groupedTool(createWriteToolDefinition(cwd), "write", groups))
  pi.registerTool(groupedTool(createLsToolDefinition(cwd), "ls", groups))
  pi.registerTool(groupedTool(createFindToolDefinition(cwd), "find", groups))
  pi.registerTool(groupedTool(createGrepToolDefinition(cwd), "grep", groups))
}

function groupedTool<TParams extends TSchema, TDetails, TState>(
  base: ToolDefinition<TParams, TDetails, TState>,
  toolName: ToolName,
  groups: ToolGroupManager,
): ToolDefinition<TParams, TDetails, TState> {
  return {
    ...base,
    renderShell: "self",
    renderCall(args, theme, context) {
      return groups.renderCall(toolName, asArguments(args), theme, {
        args: asArguments(args),
        toolCallId: context.toolCallId,
        lastComponent: context.lastComponent,
        isError: context.isError,
      })
    },
    renderResult(result, options, theme, context) {
      groups.recordResult(toolName, result, options, {
        args: asArguments(context.args),
        toolCallId: context.toolCallId,
        lastComponent: context.lastComponent,
        isError: context.isError,
      })
      if (options.expanded) {
        return base.renderResult?.(result, options, theme, context) ?? hidden()
      }
      return hidden()
    },
  }
}

class ToolGroupManager {
  private readonly itemsByCallId = new Map<string, ToolGroupItem>()
  private currentGroup: ToolGroup | undefined
  private nextGroupId = 1

  constructor(private readonly cwd: string) {}

  restore(entries: readonly SessionEntry[]): void {
    for (const entry of entries) {
      if (entry?.type !== "message") {
        continue
      }
      if (entry.message?.role === "user") {
        this.breakGroup()
        continue
      }
      if (entry.message?.role !== "assistant") {
        continue
      }

      const content = Array.isArray(entry.message.content)
        ? entry.message.content
        : []
      for (const part of content) {
        if (
          part?.type === "toolCall" &&
          isToolName(part.name) &&
          typeof part.id === "string"
        ) {
          this.ensureItem(part.name, part.id, asArguments(part.arguments))
        } else if (part?.type === "text" && part.text?.trim()) {
          this.breakGroup()
        } else if (part?.type === "toolCall") {
          this.breakGroup()
        }
      }
    }
  }

  breakGroup(): void {
    this.currentGroup = undefined
  }

  renderCall(
    toolName: ToolName,
    args: ToolArguments,
    theme: Theme,
    context: GroupedRenderContext,
  ): Component {
    const item = this.ensureItem(toolName, context.toolCallId, args)
    if (item.group.items[0] !== item) {
      return hidden()
    }

    const previous = context.lastComponent
    if (
      previous instanceof ToolGroupComponent &&
      previous.groupId === item.group.id
    ) {
      previous.setTheme(theme)
      return previous
    }
    return new ToolGroupComponent(item.group, theme)
  }

  recordResult(
    toolName: ToolName,
    result: AgentToolResult<unknown>,
    options: ToolRenderResultOptions,
    context: GroupedRenderContext,
  ): void {
    const item = this.ensureItem(toolName, context.toolCallId, context.args)
    item.status = options.isPartial
      ? "pending"
      : context.isError
        ? "error"
        : "success"
    item.error = context.isError ? errorSummary(result) : undefined
    item.metadata = mutationMetadata(toolName, context.args, result)
  }

  private ensureItem(
    toolName: ToolName,
    toolCallId: string,
    args: ToolArguments,
  ): ToolGroupItem {
    const existing = this.itemsByCallId.get(toolCallId)
    if (existing) {
      const description = describeTool(toolName, args, this.cwd)
      existing.action = description.action
      existing.target = description.target
      return existing
    }

    const kind = groupKind(toolName)
    if (!this.currentGroup || this.currentGroup.kind !== kind) {
      this.currentGroup = { id: this.nextGroupId++, kind, items: [] }
    }

    const description = describeTool(toolName, args, this.cwd)
    const item: ToolGroupItem = {
      toolCallId,
      toolName,
      action: description.action,
      target: description.target,
      status: "pending",
      group: this.currentGroup,
    }
    this.currentGroup.items.push(item)
    this.itemsByCallId.set(toolCallId, item)
    return item
  }
}

class ToolGroupComponent implements Component {
  constructor(
    private readonly group: ToolGroup,
    private theme: Theme,
  ) {}

  get groupId(): number {
    return this.group.id
  }

  setTheme(theme: Theme): void {
    this.theme = theme
  }

  render(width: number): string[] {
    const lines = [
      truncateToWidth(groupHeader(this.theme, this.group), width, "…"),
    ]
    for (const [index, item] of this.group.items.entries()) {
      const last = index === this.group.items.length - 1
      lines.push(
        truncateToWidth(groupItemLine(this.theme, item, last), width, "…"),
      )
      if (item.error) {
        lines.push(
          truncateToWidth(
            groupErrorLine(this.theme, item.error, last),
            width,
            "…",
          ),
        )
      }
    }
    return lines
  }

  invalidate(): void {}
}

function groupHeader(theme: Theme, group: ToolGroup): string {
  const status = groupStatus(group)
  const color =
    status === "error" ? "error" : status === "success" ? "success" : "muted"
  return `${theme.fg(color, "●")} ${theme.fg("toolTitle", theme.bold(GROUP_LABELS[group.kind]))}`
}

function groupItemLine(
  theme: Theme,
  item: ToolGroupItem,
  last: boolean,
): string {
  const connector = last ? "└─" : "├─"
  const action = item.action ? `${theme.fg("toolTitle", item.action)} ` : ""
  const metadata = item.metadata ? theme.fg("dim", ` · ${item.metadata}`) : ""
  const error = item.status === "error" ? ` ${theme.fg("error", "✗")}` : ""
  return `  ${theme.fg("dim", connector)} ${action}${theme.fg("accent", item.target)}${metadata}${error}`
}

function groupErrorLine(theme: Theme, error: string, last: boolean): string {
  const stem = last ? "   " : "│  "
  return `  ${theme.fg("dim", stem)} ${theme.fg("dim", "└─")} ${theme.fg("error", error)}`
}

function groupStatus(group: ToolGroup): ItemStatus {
  if (group.items.some((item) => item.status === "error")) {
    return "error"
  }
  if (group.items.every((item) => item.status === "success")) {
    return "success"
  }
  return "pending"
}

function groupKind(toolName: ToolName): GroupKind {
  if (toolName === "edit" || toolName === "write") {
    return "changes"
  }
  return toolName
}

function describeTool(
  toolName: ToolName,
  args: ToolArguments,
  cwd: string,
): { action?: string; target: string } {
  if (toolName === "read") {
    return { target: displayPath(args.path ?? args.file_path, cwd) }
  }
  if (toolName === "bash") {
    return { target: cropBashCommand(stringArgument(args.command)) || "…" }
  }
  if (toolName === "edit" || toolName === "write") {
    return {
      action: toolName === "edit" ? "Edit" : "Write",
      target: displayPath(args.path ?? args.file_path, cwd),
    }
  }
  if (toolName === "ls") {
    return { target: displayPath(args.path || ".", cwd) }
  }
  if (toolName === "find") {
    return {
      target: `${stringArgument(args.pattern) || "…"} in ${displayPath(args.path || ".", cwd)}`,
    }
  }
  return {
    target: `/${stringArgument(args.pattern) || "…"}/ in ${displayPath(args.path || ".", cwd)}`,
  }
}

function mutationMetadata<TDetails>(
  toolName: ToolName,
  args: ToolArguments,
  result: AgentToolResult<TDetails>,
): string | undefined {
  if (toolName === "write") {
    const content = stringArgument(args.content)
    return `${formatSize(Buffer.byteLength(content, "utf8"))} · ${plural(lineCount(content), "line")}`
  }
  if (toolName !== "edit") {
    return undefined
  }

  const details = result.details as { diff?: string } | undefined
  const stats = diffStats(details?.diff)
  if (!stats.added && !stats.removed) {
    return undefined
  }
  return `+${stats.added} −${stats.removed}`
}

function errorSummary<TDetails>(result: AgentToolResult<TDetails>): string {
  const output = textOutput(result)
  return oneLine(
    output.split("\n").filter(Boolean).at(-1) ?? "Tool failed",
    120,
  )
}

function diffStats(diff: string | undefined): {
  added: number
  removed: number
} {
  if (!diff) {
    return { added: 0, removed: 0 }
  }

  let added = 0
  let removed = 0
  for (const line of diff.split("\n")) {
    if (/^\+\s*\d*\s/.test(line) || /^\+[^+]/.test(line)) {
      added++
    } else if (/^-\s*\d*\s/.test(line) || /^-[^-]/.test(line)) {
      removed++
    }
  }
  return { added, removed }
}

function textOutput<TDetails>(
  result: AgentToolResult<TDetails> | undefined,
): string {
  if (!result) {
    return ""
  }
  return result.content
    .map((part) => {
      if (part.type === "text") {
        return part.text
      }
      return `[image${part.mimeType ? `: ${part.mimeType}` : ""}]`
    })
    .filter(Boolean)
    .join("\n")
}

function displayPath(raw: unknown, cwd: string): string {
  const path = stringArgument(raw)
  if (!path) {
    return "…"
  }
  if (!isAbsolute(path)) {
    return path
  }
  const relativePath = relative(cwd, path)
  return relativePath && !relativePath.startsWith("..") ? relativePath : path
}

function cropBashCommand(command: string): string {
  const compact = command.replace(/\s+/g, " ").trim()
  return compact.length > 80 ? `${compact.slice(0, 80)}...` : compact
}

function oneLine(value: string, max = 160): string {
  const compact = value.replace(/\s+/g, " ").trim()
  return compact.length > max
    ? `${compact.slice(0, Math.max(0, max - 1))}…`
    : compact
}

function lineCount(text: string): number {
  if (!text) {
    return 0
  }
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text
  return trimmed ? trimmed.split("\n").length : 0
}

function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return `${count} ${count === 1 ? singular : pluralForm}`
}

function stringArgument(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function asArguments(value: unknown): ToolArguments {
  return value && typeof value === "object" ? (value as ToolArguments) : {}
}

function isToolName(value: unknown): value is ToolName {
  return typeof value === "string" && SUPPORTED_TOOLS.has(value as ToolName)
}

function hidden(): Container {
  return new Container()
}
