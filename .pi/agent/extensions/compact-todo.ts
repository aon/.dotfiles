import type {
  ExtensionAPI,
  ExtensionUIContext,
  Theme,
} from "@earendil-works/pi-coding-agent"
import {
  Container,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui"

import { loadConfig, validateGuidanceFields } from "../npm/node_modules/@juicesharp/rpiv-todo/config.ts"
import { replayFromBranch } from "../npm/node_modules/@juicesharp/rpiv-todo/state/replay.ts"
import {
  selectOverlayLayout,
  selectShowTaskIds,
  selectTodoCounts,
} from "../npm/node_modules/@juicesharp/rpiv-todo/state/selectors.ts"
import type { TaskState } from "../npm/node_modules/@juicesharp/rpiv-todo/state/state.ts"
import { applyTaskMutation } from "../npm/node_modules/@juicesharp/rpiv-todo/state/state-reducer.ts"
import {
  commitState,
  getState,
  replaceState,
} from "../npm/node_modules/@juicesharp/rpiv-todo/state/store.ts"
import {
  DEFAULT_PROMPT_GUIDELINES,
  DEFAULT_PROMPT_SNIPPET,
  registerTodosCommand,
} from "../npm/node_modules/@juicesharp/rpiv-todo/todo.ts"
import { buildToolResult } from "../npm/node_modules/@juicesharp/rpiv-todo/tool/response-envelope.ts"
import {
  type Task,
  type TaskMutationParams,
  TOOL_LABEL,
  TOOL_NAME,
  TodoParamsSchema,
} from "../npm/node_modules/@juicesharp/rpiv-todo/tool/types.ts"
import { formatOverlayTaskLine } from "../npm/node_modules/@juicesharp/rpiv-todo/view/format.ts"

const WIDGET_KEY = "rpiv-todos"
const MAX_PANEL_LINES = 12

export default function compactTodoExtension(pi: ExtensionAPI) {
  let display: CompactTodoDisplay | undefined

  registerHiddenTodoTool(pi)
  registerTodosCommand(pi)

  pi.on("session_start", (_event, ctx) => {
    replaceState(replayFromBranch(ctx))
    if (!ctx.hasUI) {
      return
    }

    display ??= new CompactTodoDisplay()
    display.setUIContext(ctx.ui)
    display.resetCompletedDisplayState()
    display.showIdle()
  })

  pi.on("session_compact", (_event, ctx) => {
    replayState(ctx)
    display?.resetCompletedDisplayState()
    display?.update()
  })

  pi.on("session_tree", (_event, ctx) => {
    replayState(ctx)
    display?.resetCompletedDisplayState()
    display?.update()
  })

  pi.on("session_shutdown", () => {
    display?.dispose()
    display = undefined
  })

  pi.on("tool_execution_end", (event) => {
    if (event.toolName === TOOL_NAME && !event.isError) {
      display?.update()
    }
  })

  pi.on("agent_start", () => {
    display?.showWorking()
  })

  pi.on("agent_end", () => {
    display?.showIdle()
  })
}

function registerHiddenTodoTool(pi: ExtensionAPI): void {
  const guidance = validateGuidanceFields(loadConfig().guidance)

  pi.registerTool({
    name: TOOL_NAME,
    label: TOOL_LABEL,
    description:
      "Manage a task list for tracking multi-step progress. Actions: create (new task), update (change status/fields/dependencies), list (all tasks, optionally filtered by status), get (single task details), delete (tombstone), clear (reset all). Status: pending → in_progress → completed, plus deleted tombstone. Use this to plan and track multi-step work like research, design, and implementation.",
    promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
    promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
    parameters: TodoParamsSchema,
    renderShell: "self" as const,

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const result = applyTaskMutation(
        getState(),
        params.action,
        params as TaskMutationParams,
      )
      commitState(result.state)
      return buildToolResult(
        params.action,
        params as TaskMutationParams,
        result.state,
        result.op,
      )
    },

    renderCall: hidden,
    renderResult: hidden,
  })
}

class CompactTodoDisplay {
  private ui: ExtensionUIContext | undefined
  private tui: TUI | undefined
  private widgetRegistered = false
  private working = false
  private completedTaskIdsPendingHide = new Set<number>()
  private hiddenCompletedTaskIds = new Set<number>()
  private lastNextId: number | undefined

  setUIContext(ui: ExtensionUIContext): void {
    if (ui === this.ui) {
      return
    }

    this.ui = ui
    this.tui = undefined
    this.widgetRegistered = false
  }

  showWorking(): void {
    this.hideCompletedTasksFromPreviousTurn()
    this.working = true
    this.update()
  }

  showIdle(): void {
    this.working = false
    this.update()
  }

  update(): void {
    if (!this.ui) {
      return
    }

    const state = this.getVisibleState()
    if (this.working) {
      this.removeWidget()
      this.ui.setWorkingMessage(this.formatWorkingMessage(state))
      return
    }

    this.ui.setWorkingMessage()
    if (state.tasks.length === 0) {
      this.removeWidget()
      return
    }

    if (!this.widgetRegistered) {
      this.ui.setWidget(
        WIDGET_KEY,
        (tui, theme) => {
          this.tui = tui
          return {
            render: (width: number) => this.renderIdleWidget(theme, width),
            invalidate() {},
          }
        },
        { placement: "aboveEditor" },
      )
      this.widgetRegistered = true
      return
    }

    this.tui?.requestRender()
  }

  resetCompletedDisplayState(): void {
    this.completedTaskIdsPendingHide.clear()
    this.hiddenCompletedTaskIds.clear()
    this.lastNextId = undefined
  }

  dispose(): void {
    this.ui?.setWorkingMessage()
    this.removeWidget()
    this.ui = undefined
    this.tui = undefined
    this.working = false
    this.resetCompletedDisplayState()
  }

  private formatWorkingMessage(state: TaskState): string {
    if (!this.ui || state.tasks.length === 0) {
      return "Working..."
    }

    const taskLines = this.formatTaskLines(state, this.ui.theme)
    return ["Working...", ...taskLines].join("\n")
  }

  private renderIdleWidget(theme: Theme, width: number): string[] {
    const state = this.getVisibleState()
    if (state.tasks.length === 0) {
      return []
    }

    const truncate = (line: string): string =>
      truncateToWidth(line, width, "…")
    const lines = [
      truncate(theme.fg("muted", formatTaskCountHeader(state, theme))),
      ...this.formatTaskLines(state, theme).map(truncate),
      "",
    ]
    return lines
  }

  private formatTaskLines(state: TaskState, theme: Theme): string[] {
    const showIds = selectShowTaskIds(state)
    const layout = selectOverlayLayout(state, MAX_PANEL_LINES - 1)
    const lines = layout.visible.map(
      (task) =>
        `${theme.fg("dim", "├─")} ${formatOverlayTaskLine(task, theme, showIds)}`,
    )

    this.trackDisplayedCompletedTasks(state.tasks)

    if (layout.hiddenCompleted === 0 && layout.truncatedTail === 0) {
      const last = lines.length - 1
      if (last >= 0) {
        lines[last] = lines[last].replace("├─", "└─")
      }
      return lines
    }

    const hiddenCount = layout.hiddenCompleted + layout.truncatedTail
    const hiddenParts: string[] = []
    if (layout.hiddenCompleted > 0) {
      hiddenParts.push(`${layout.hiddenCompleted} done`)
    }
    if (layout.truncatedTail > 0) {
      hiddenParts.push(`${layout.truncatedTail} open`)
    }
    const detail = hiddenParts.length > 0 ? ` (${hiddenParts.join(", ")})` : ""
    lines.push(
      `${theme.fg("dim", "└─")} ${theme.fg("dim", `+${hiddenCount} more${detail}`)}`,
    )
    return lines
  }

  private getVisibleState(): TaskState {
    const state = getState()
    if (this.lastNextId !== undefined && state.nextId < this.lastNextId) {
      this.resetCompletedDisplayState()
    }
    this.lastNextId = state.nextId

    const completedTaskIds = new Set(
      state.tasks
        .filter((task) => task.status === "completed")
        .map((task) => task.id),
    )
    for (const taskId of this.completedTaskIdsPendingHide) {
      if (!completedTaskIds.has(taskId)) {
        this.completedTaskIdsPendingHide.delete(taskId)
      }
    }
    for (const taskId of this.hiddenCompletedTaskIds) {
      if (!completedTaskIds.has(taskId)) {
        this.hiddenCompletedTaskIds.delete(taskId)
      }
    }

    return {
      tasks: state.tasks.filter(
        (task) =>
          task.status !== "deleted" &&
          !this.hiddenCompletedTaskIds.has(task.id),
      ),
      nextId: state.nextId,
    }
  }

  private trackDisplayedCompletedTasks(tasks: readonly Task[]): void {
    for (const task of tasks) {
      if (
        task.status === "completed" &&
        !this.completedTaskIdsPendingHide.has(task.id) &&
        !this.hiddenCompletedTaskIds.has(task.id)
      ) {
        this.completedTaskIdsPendingHide.add(task.id)
      }
    }
  }

  private hideCompletedTasksFromPreviousTurn(): void {
    for (const taskId of this.completedTaskIdsPendingHide) {
      this.hiddenCompletedTaskIds.add(taskId)
    }
    this.completedTaskIdsPendingHide.clear()
  }

  private removeWidget(): void {
    if (!this.ui || !this.widgetRegistered) {
      return
    }

    this.ui.setWidget(WIDGET_KEY, undefined)
    this.widgetRegistered = false
    this.tui = undefined
  }
}

function formatTaskCountHeader(state: TaskState, theme: Theme): string {
  const counts = selectTodoCounts(state)
  const taskLabel = counts.total === 1 ? "task" : "tasks"
  const statusCounts = [`${theme.bold(String(counts.completed))} done`]
  if (counts.inProgress > 0) {
    statusCounts.push(`${theme.bold(String(counts.inProgress))} in progress`)
  }
  statusCounts.push(`${theme.bold(String(counts.pending))} open`)
  return `${theme.bold(String(counts.total))} ${taskLabel} (${statusCounts.join(", ")})`
}

function replayState(ctx: Parameters<typeof replayFromBranch>[0]): void {
  try {
    replaceState(replayFromBranch(ctx))
  } catch (error) {
    if (!/stale after session replacement/.test(String(error))) {
      throw error
    }
  }
}

function hidden(): Container {
  return new Container()
}
