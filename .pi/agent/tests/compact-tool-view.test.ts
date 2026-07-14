import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

type Renderable = { render(width: number): string[] }
type Theme = {
  fg(color: string, text: string): string
  bg(color: string, text: string): string
  bold(text: string): string
}
type RegisteredTool = {
  name: string
  renderCall(
    args: unknown,
    theme: Theme,
    context: ReturnType<typeof renderContext>,
  ): Renderable
  renderResult(
    result: unknown,
    options: { expanded: boolean; isPartial: boolean },
    theme: Theme,
    context: ReturnType<typeof renderContext>,
  ): Renderable
}
type RegisteredCommand = {
  handler(args: string, context: unknown): unknown
}
type EntryRenderer = (
  entry: unknown,
  options: { expanded: boolean },
  theme: Theme,
) => unknown

const agentDir = mkdtempSync(join(tmpdir(), "compact-tool-view-"))
Bun.env.PI_CODING_AGENT_DIR = agentDir
writeFileSync(join(agentDir, "compact-tool-view.json"), '{"compact":true}\n')

const { default: compactToolViewExtension } = await import(
  `../extensions/compact-tool-view.ts?test=${Date.now()}`
)

try {
  await testCompactRenderingAndLiveSummary()
  await testSavedModeRestoresInNewSession()
  console.log("compact-tool-view tests passed")
} finally {
  rmSync(agentDir, { recursive: true, force: true })
}

async function testCompactRenderingAndLiveSummary(): Promise<void> {
  const harness = createHarness()
  await harness.emit("session_start")
  const read = harness.tools.get("read")
  assert.ok(read)

  const collapsedContext = renderContext(false)
  assert.deepEqual(
    read.renderCall({ path: "README.md" }, harness.theme, collapsedContext)
      .render(80),
    [],
  )

  const expandedContext = renderContext(true)
  assert.match(
    read
      .renderCall({ path: "README.md" }, harness.theme, expandedContext)
      .render(80)
      .join("\n"),
    /Read README\.md/,
  )
  const expandedResult = read
    .renderResult(
      {
        content: [{ type: "text", text: "first\nsecond" }],
        details: undefined,
      },
      { expanded: true, isPartial: false },
      harness.theme,
      expandedContext,
    )
    .render(80)
    .join("\n")
  assert.match(expandedResult, /first/)
  assert.match(expandedResult, /second/)

  await harness.emit("agent_start")
  await harness.emit("tool_execution_start", {
    toolCallId: "read-1",
    toolName: "read",
    args: { path: "README.md" },
  })
  assert.match(harness.workingMessages.at(-1) ?? "", /^Working\.\.\./)
  assert.match(harness.workingMessages.at(-1) ?? "", /1 read/)
  assert.doesNotMatch(harness.workingMessages.at(-1) ?? "", /^Work\s/)

  await harness.emit("tool_execution_end", {
    toolCallId: "read-1",
    toolName: "read",
    isError: false,
  })
  await harness.emit("agent_settled")
  assert.equal(harness.workingMessages.at(-1), undefined)
  assert.deepEqual(harness.entries.at(-1)?.data, {
    readFiles: 1,
    editedFiles: 0,
    createdFiles: 0,
    shellRuns: 0,
    searches: 0,
    directoriesListed: 0,
    failures: 0,
  })

  const summaryRenderer = harness.renderers.get("compact-tool-view-summary")
  assert.ok(summaryRenderer)
  assert.ok(summaryRenderer(harness.entries.at(-1), { expanded: false }, harness.theme))
  assert.equal(
    summaryRenderer(harness.entries.at(-1), { expanded: true }, harness.theme),
    undefined,
  )
}

async function testSavedModeRestoresInNewSession(): Promise<void> {
  const compactSession = createHarness()
  await compactSession.emit("session_start")
  await compactSession.commands.get("tool-view")?.handler("full", compactSession.ctx)
  assert.deepEqual(
    JSON.parse(readFileSync(join(agentDir, "compact-tool-view.json"), "utf8")),
    { compact: false },
  )

  const fullSession = createHarness()
  await fullSession.emit("session_start")
  const read = fullSession.tools.get("read")
  assert.ok(read)
  assert.match(
    read
      .renderCall({ path: "README.md" }, fullSession.theme, renderContext(false))
      .render(80)
      .join("\n"),
    /Read README\.md/,
  )
}

function createHarness() {
  const handlers = new Map<string, Array<(event: unknown, context: unknown) => unknown>>()
  const tools = new Map<string, RegisteredTool>()
  const commands = new Map<string, RegisteredCommand>()
  const renderers = new Map<string, EntryRenderer>()
  const entries: Array<{ customType: string; data: unknown }> = []
  const workingMessages: Array<string | undefined> = []
  const theme = {
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
  }
  const ctx = {
    cwd: process.cwd(),
    sessionManager: { getBranch: () => [] },
    ui: {
      theme,
      notify() {},
      setWorkingMessage(message?: string) {
        workingMessages.push(message)
      },
      setStatus() {},
      setWidget() {},
      getToolsExpanded: () => false,
      setToolsExpanded() {},
    },
  }

  compactToolViewExtension({
    registerTool(tool: RegisteredTool) {
      tools.set(tool.name, tool)
    },
    registerCommand(name: string, command: RegisteredCommand) {
      commands.set(name, command)
    },
    registerEntryRenderer(name: string, renderer: EntryRenderer) {
      renderers.set(name, renderer)
    },
    appendEntry(customType: string, data: unknown) {
      entries.push({ customType, data })
    },
    on(name: string, handler: (event: unknown, context: unknown) => unknown) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler])
    },
  } as never)

  return {
    commands,
    ctx,
    entries,
    renderers,
    theme,
    tools,
    workingMessages,
    async emit(eventName: string, event: unknown = {}) {
      for (const handler of handlers.get(eventName) ?? []) {
        await handler(event, ctx)
      }
    },
  }
}

function renderContext(expanded: boolean) {
  return {
    args: { path: "README.md" },
    toolCallId: "read-1",
    invalidate() {},
    lastComponent: undefined,
    state: {},
    cwd: process.cwd(),
    executionStarted: true,
    argsComplete: true,
    isPartial: false,
    expanded,
    showImages: true,
    isError: false,
  }
}
