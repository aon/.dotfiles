import assert from "node:assert/strict"

import compactTodoExtension from "../extensions/compact-todo.ts"

type Handler = (event: unknown, context: unknown) => unknown
type Renderable = { render(width: number): string[] }
type WidgetFactory = (
  tui: { requestRender(): void },
  theme: typeof theme,
) => Renderable

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  strikethrough: (text: string) => text,
}

const { handlers, ui } = loadExtension()

assert.deepEqual(ui.widget?.render(120), [
  "2 tasks (0 done, 1 in progress, 1 open)",
  "├─ ◐ Implement display (implementing display)",
  "└─ ○ Verify behavior",
  "",
])

runHandlers(handlers, "agent_start")
assert.equal(ui.widget, undefined)
assert.equal(
  ui.workingMessage,
  [
    "Working...",
    "├─ ◐ Implement display (implementing display)",
    "└─ ○ Verify behavior",
  ].join("\n"),
)

runHandlers(handlers, "agent_end")
assert.equal(ui.workingMessage, undefined)
assert.equal(
  ui.widget?.render(120)[0],
  "2 tasks (0 done, 1 in progress, 1 open)",
)

const pendingOnly = loadExtension([
  { id: 1, subject: "First task", status: "pending" },
  { id: 2, subject: "Second task", status: "pending" },
])
assert.equal(
  pendingOnly.ui.widget?.render(120)[0],
  "2 tasks (0 done, 2 open)",
)

console.log("compact-todo display tests passed")

function loadExtension(tasks: unknown[] = defaultTasks()): {
  handlers: Map<string, Handler[]>
  ui: {
    theme: typeof theme
    widget: Renderable | undefined
    workingMessage: string | undefined
    setWidget(
      key: string,
      content: WidgetFactory | undefined,
      options?: { placement?: string },
    ): void
    setWorkingMessage(message?: string): void
  }
} {
  const handlers = new Map<string, Handler[]>()
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler])
    },
    registerTool() {},
    registerCommand() {},
  }
  const ui = {
    theme,
    widget: undefined as Renderable | undefined,
    workingMessage: undefined as string | undefined,
    setWidget(
      _key: string,
      content: WidgetFactory | undefined,
      _options?: { placement?: string },
    ) {
      this.widget = content
        ? content({ requestRender() {} }, theme)
        : undefined
    },
    setWorkingMessage(message?: string) {
      this.workingMessage = message
    },
  }

  compactTodoExtension(pi as never)
  runHandlers(handlers, "session_start", {
    hasUI: true,
    ui,
    sessionManager: {
      getBranch: () => [todoStateEntry(tasks)],
    },
  })

  return { handlers, ui }
}

function runHandlers(
  handlers: Map<string, Handler[]>,
  eventName: string,
  context: unknown = {},
): void {
  for (const handler of handlers.get(eventName) ?? []) {
    handler({}, context)
  }
}

function defaultTasks() {
  return [
    {
      id: 1,
      subject: "Implement display",
      activeForm: "implementing display",
      status: "in_progress",
    },
    {
      id: 2,
      subject: "Verify behavior",
      status: "pending",
    },
  ]
}

function todoStateEntry(tasks: unknown[]) {
  return {
    type: "message",
    message: {
      role: "toolResult",
      toolName: "todo",
      details: {
        action: "list",
        params: {},
        tasks,
        nextId: 3,
      },
    },
  }
}
