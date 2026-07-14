import assert from "node:assert/strict"

import compactToolsExtension from "../extensions/compact-tools.ts"

type Handler = (event: unknown, context: unknown) => unknown
type Renderable = { render(width: number): string[] }
type RegisteredTool = {
  renderCall(
    args: { command: string },
    theme: typeof theme,
    context: ReturnType<typeof renderContext>,
  ): Renderable
}

const theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
}

testRestoredSequentialBashCommands()
testLiveSequentialBashCommands()
testNewUserRequestStartsNewGroup()
console.log("compact-tools sequential Bash grouping tests passed")

function testRestoredSequentialBashCommands(): void {
  const branch = [
    userMessage("u1", "Inspect the repository"),
    assistantBashMessage("a1", "b1", "git status --short"),
    toolResultMessage("r1", "b1"),
    assistantBashMessage("a2", "b2", "git log -1 --oneline"),
    toolResultMessage("r2", "b2"),
  ]
  const { bash } = loadExtension(branch)

  const first = renderBashCall(bash, "b1", "git status --short")
  const second = renderBashCall(bash, "b2", "git log -1 --oneline")
  const firstText = first.render(120).join("\n")

  assert.match(firstText, /git status --short/)
  assert.match(firstText, /git log -1 --oneline/)
  assert.deepEqual(second.render(120), [])
}

function testLiveSequentialBashCommands(): void {
  const { handlers, bash } = loadExtension([])
  startAgent(handlers)

  const first = renderBashCall(bash, "b1", "git status --short")
  runHandlers(handlers, "turn_start")
  const second = renderBashCall(bash, "b2", "git log -1 --oneline")
  const firstText = first.render(120).join("\n")

  assert.match(firstText, /git status --short/)
  assert.match(firstText, /git log -1 --oneline/)
  assert.deepEqual(second.render(120), [])
}

function testNewUserRequestStartsNewGroup(): void {
  const { handlers, bash } = loadExtension([])
  startAgent(handlers)
  const first = renderBashCall(bash, "b1", "git status --short")

  startAgent(handlers)
  const second = renderBashCall(bash, "b2", "git log -1 --oneline")

  assert.doesNotMatch(first.render(120).join("\n"), /git log -1 --oneline/)
  assert.match(second.render(120).join("\n"), /git log -1 --oneline/)
}

function loadExtension(branch: unknown[]): {
  handlers: Map<string, Handler[]>
  bash: RegisteredTool
} {
  const handlers = new Map<string, Handler[]>()
  const tools = new Map<string, RegisteredTool>()
  const pi = {
    on(name: string, handler: Handler) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler])
    },
    registerTool(tool: RegisteredTool & { name: string }) {
      tools.set(tool.name, tool)
    },
  }

  compactToolsExtension(pi as never)
  runHandlers(handlers, "session_start", {
    cwd: "/repo",
    sessionManager: { getBranch: () => branch },
  })

  const bash = tools.get("bash")
  if (!bash) {
    throw new Error("Bash tool was not registered")
  }
  return { handlers, bash }
}

function startAgent(handlers: Map<string, Handler[]>): void {
  runHandlers(handlers, "before_agent_start")
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

function renderBashCall(
  bash: RegisteredTool,
  toolCallId: string,
  command: string,
): Renderable {
  return bash.renderCall({ command }, theme, renderContext(toolCallId, command))
}

function renderContext(toolCallId: string, command: string) {
  return {
    args: { command },
    toolCallId,
    invalidate() {},
    lastComponent: undefined,
    state: {},
    cwd: "/repo",
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded: false,
    showImages: true,
    isError: false,
  }
}

function userMessage(id: string, text: string) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "",
    message: { role: "user", content: [{ type: "text", text }] },
  }
}

function assistantBashMessage(id: string, callId: string, command: string) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "",
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Checking" },
        { type: "toolCall", id: callId, name: "bash", arguments: { command } },
      ],
    },
  }
}

function toolResultMessage(id: string, callId: string) {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: "",
    message: {
      role: "toolResult",
      toolCallId: callId,
      toolName: "bash",
      content: [{ type: "text", text: "ok" }],
      isError: false,
    },
  }
}
