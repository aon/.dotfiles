import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  formatSize,
  renderDiff,
  type AgentToolResult,
  type BashToolDetails,
  type EditToolDetails,
  type ExtensionAPI,
  type FindToolDetails,
  type GrepToolDetails,
  type LsToolDetails,
  type ReadToolDetails,
} from "@earendil-works/pi-coding-agent";
import { Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { isAbsolute, relative } from "node:path";

type ThemeLike = {
  fg(color: string, text: string): string;
  bold(text: string): string;
};

type RenderContext = {
  args: any;
  cwd: string;
  state: Record<string, any>;
  expanded: boolean;
  isPartial: boolean;
  isError: boolean;
  executionStarted: boolean;
  invalidate(): void;
};

function textOutput(result: AgentToolResult<any> | undefined): string {
  if (!result) return "";
  return result.content
    .map((part: any) => {
      if (part?.type === "text") return part.text ?? "";
      if (part?.type === "image") return `[image${part.mimeType ? `: ${part.mimeType}` : ""}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function lineCount(text: string): number {
  if (!text) return 0;
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (!trimmed) return 0;
  return trimmed.split("\n").length;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function displayPath(raw: unknown, cwd: string): string {
  const path = typeof raw === "string" ? raw : "";
  if (!path) return "…";
  if (!isAbsolute(path)) return path;
  const rel = relative(cwd, path);
  return rel && !rel.startsWith("..") ? rel : path;
}

function oneLine(value: string, max = 96): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > max ? `${compact.slice(0, Math.max(0, max - 1))}…` : compact;
}

function markerColor(context: RenderContext): "success" | "error" | "muted" {
  if (context.isError) return "error";
  if (context.isPartial) return "muted";
  return "success";
}

function header(theme: ThemeLike, action: string, target: string, context: RenderContext): string {
  return `${theme.fg(markerColor(context), "●")} ${theme.fg("toolTitle", theme.bold(action))} ${theme.fg("accent", target)}`;
}

function resultLine(theme: ThemeLike, summary: string, _kind: "success" | "error" | "muted" = "muted"): string {
  return `  ${theme.fg("dim", "└─")} ${theme.fg("dim", summary)}`;
}

function asText(text: string): Text {
  return new Text(text, 0, 0);
}

function expandedBlock(theme: ThemeLike, title: string, body: string, maxWidth?: number): Container {
  const container = new Container();
  container.addChild(asText(resultLine(theme, title, "muted")));
  if (body) {
    container.addChild(asText(`\n${body}`));
  }
  return container;
}

function readSummary(result: AgentToolResult<ReadToolDetails | undefined>, args: any): string {
  const truncation = result.details?.truncation;
  if (truncation?.truncated) {
    return `Read ${truncation.outputLines} of ${truncation.totalLines} lines`;
  }

  const output = textOutput(result);
  if (/^Read image file/m.test(output)) return output.split("\n")[0] ?? "Read image";

  const explicitLimit = typeof args?.limit === "number" ? args.limit : undefined;
  const count = lineCount(output.replace(/\n\n\[[^\]]+\]$/s, ""));
  return `Read ${plural(explicitLimit ? Math.min(explicitLimit, count || explicitLimit) : count, "line")}`;
}

function writeSummary(args: any): string {
  const content = typeof args?.content === "string" ? args.content : "";
  const bytes = Buffer.byteLength(content, "utf8");
  return `Wrote ${formatSize(bytes)} · ${plural(lineCount(content), "line")}`;
}

function diffStats(diff: string | undefined): { added: number; removed: number } {
  if (!diff) return { added: 0, removed: 0 };
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (/^\+\s*\d*\s/.test(line) || /^\+[^+]/.test(line)) added++;
    else if (/^-\s*\d*\s/.test(line) || /^-[^-]/.test(line)) removed++;
  }
  return { added, removed };
}

function editSummary(args: any, result: AgentToolResult<EditToolDetails | undefined>): string {
  const edits = Array.isArray(args?.edits) ? args.edits.length : args?.oldText && args?.newText ? 1 : 0;
  const stats = diffStats(result.details?.diff);
  const parts = [plural(edits, "replacement")];
  if (stats.added || stats.removed) parts.push(`+${stats.added} -${stats.removed}`);
  return parts.join(" · ");
}

function bashSummary(
  result: AgentToolResult<BashToolDetails | undefined>,
  context: RenderContext,
): string {
  const output = textOutput(result).trim();
  const truncation = result.details?.truncation;
  const lines = truncation?.totalLines ?? lineCount(output === "(no output)" ? "" : output);

  const startedAt = context.state.startedAt as number | undefined;
  const endedAt = context.state.endedAt as number | undefined;
  const elapsed = startedAt ? `${(((endedAt ?? Date.now()) - startedAt) / 1000).toFixed(1)}s` : undefined;

  if (context.isPartial) {
    return ["Running", elapsed, lines ? plural(lines, "line") : undefined].filter(Boolean).join(" · ");
  }

  if (context.isError) {
    const lastLine = output.split("\n").filter(Boolean).at(-1) ?? "Command failed";
    return [oneLine(lastLine, 72), elapsed, lines ? plural(lines, "line") : undefined].filter(Boolean).join(" · ");
  }

  return ["Exit 0", elapsed, lines ? plural(lines, "line") : "no output"].filter(Boolean).join(" · ");
}

function compactReadRenderer(base: ReturnType<typeof createReadToolDefinition>) {
  return {
    ...base,
    renderShell: "self" as const,
    renderCall(args: any, theme: any, context: RenderContext) {
      return asText(header(theme, "Read", displayPath(args?.path ?? args?.file_path, context.cwd), context));
    },
    renderResult(result: AgentToolResult<ReadToolDetails | undefined>, options: any, theme: any, context: RenderContext) {
      if (context.isError) return asText(resultLine(theme, oneLine(textOutput(result) || "Read failed", 140), "error"));
      if (options.expanded) {
        const expanded = base.renderResult?.(result as any, options, theme, context as any);
        const container = new Container();
        container.addChild(asText(resultLine(theme, readSummary(result, context.args), "success")));
        if (expanded) container.addChild(expanded);
        return container;
      }
      return asText(resultLine(theme, readSummary(result, context.args), "success"));
    },
  };
}

function compactWriteRenderer(base: ReturnType<typeof createWriteToolDefinition>) {
  return {
    ...base,
    renderShell: "self" as const,
    renderCall(args: any, theme: any, context: RenderContext) {
      return asText(header(theme, "Write", displayPath(args?.path ?? args?.file_path, context.cwd), context));
    },
    renderResult(result: AgentToolResult<undefined>, options: any, theme: any, context: RenderContext) {
      if (context.isError) return asText(resultLine(theme, oneLine(textOutput(result) || "Write failed", 140), "error"));
      if (options.expanded && typeof context.args?.content === "string") {
        return expandedBlock(theme, writeSummary(context.args), theme.fg("toolOutput", context.args.content));
      }
      return asText(resultLine(theme, writeSummary(context.args), "success"));
    },
  };
}

function compactEditRenderer(base: ReturnType<typeof createEditToolDefinition>) {
  return {
    ...base,
    renderShell: "self" as const,
    renderCall(args: any, theme: any, context: RenderContext) {
      return asText(header(theme, "Edit", displayPath(args?.path ?? args?.file_path, context.cwd), context));
    },
    renderResult(result: AgentToolResult<EditToolDetails | undefined>, options: any, theme: any, context: RenderContext) {
      if (context.isError) return asText(resultLine(theme, oneLine(textOutput(result) || "Edit failed", 160), "error"));
      const summary = editSummary(context.args, result);
      if (options.expanded && result.details?.diff) {
        return expandedBlock(theme, summary, renderDiff(result.details.diff));
      }
      return asText(resultLine(theme, summary, "success"));
    },
  };
}

function compactBashRenderer(base: ReturnType<typeof createBashToolDefinition>) {
  return {
    ...base,
    renderShell: "self" as const,
    renderCall(args: any, theme: any, context: RenderContext) {
      if (context.executionStarted && context.state.startedAt === undefined) {
        context.state.startedAt = Date.now();
        context.state.endedAt = undefined;
      }
      const command = typeof args?.command === "string" ? args.command : "…";
      return {
        render(width: number) {
          return [truncateToWidth(header(theme, "Bash", oneLine(command, Math.max(24, width - 12)), context), width, "…")];
        },
        invalidate() {},
      };
    },
    renderResult(result: AgentToolResult<BashToolDetails | undefined>, options: any, theme: any, context: RenderContext) {
      if (context.state.startedAt !== undefined && options.isPartial && !context.state.interval) {
        context.state.interval = setInterval(() => context.invalidate(), 1000);
      }
      if (!options.isPartial || context.isError) {
        context.state.endedAt ??= Date.now();
        if (context.state.interval) {
          clearInterval(context.state.interval);
          context.state.interval = undefined;
        }
      }

      const summary = bashSummary(result, context);
      if (options.expanded) {
        const output = textOutput(result).trim();
        const body = output && output !== "(no output)" ? theme.fg("toolOutput", output) : "";
        return expandedBlock(theme, summary, body);
      }
      return asText(resultLine(theme, summary, context.isError ? "error" : options.isPartial ? "muted" : "success"));
    },
  };
}

function compactLsRenderer(base: ReturnType<typeof createLsToolDefinition>) {
  return {
    ...base,
    renderShell: "self" as const,
    renderCall(args: any, theme: any, context: RenderContext) {
      return asText(header(theme, "List", displayPath(args?.path || ".", context.cwd), context));
    },
    renderResult(result: AgentToolResult<LsToolDetails | undefined>, options: any, theme: any, context: RenderContext) {
      if (context.isError) return asText(resultLine(theme, oneLine(textOutput(result) || "List failed", 140), "error"));
      const output = textOutput(result).trim();
      const count = output === "(empty directory)" ? 0 : lineCount(output.replace(/\n\n\[[^\]]+\]$/s, ""));
      const suffix = result.details?.entryLimitReached ? "+" : "";
      const summary = count === 0 ? "Empty directory" : `Listed ${count}${suffix} entries`;
      if (options.expanded) return expandedBlock(theme, summary, output ? theme.fg("toolOutput", output) : "");
      return asText(resultLine(theme, summary, "success"));
    },
  };
}

function compactFindRenderer(base: ReturnType<typeof createFindToolDefinition>) {
  return {
    ...base,
    renderShell: "self" as const,
    renderCall(args: any, theme: any, context: RenderContext) {
      const pattern = typeof args?.pattern === "string" ? args.pattern : "…";
      const where = displayPath(args?.path || ".", context.cwd);
      return asText(header(theme, "Find", `${pattern} in ${where}`, context));
    },
    renderResult(result: AgentToolResult<FindToolDetails | undefined>, options: any, theme: any, context: RenderContext) {
      if (context.isError) return asText(resultLine(theme, oneLine(textOutput(result) || "Find failed", 140), "error"));
      const output = textOutput(result).trim();
      const noResults = /^No files found/m.test(output);
      const count = noResults ? 0 : lineCount(output.replace(/\n\n\[[^\]]+\]$/s, ""));
      const suffix = result.details?.resultLimitReached ? "+" : "";
      const summary = count === 0 ? "No files found" : `Found ${count}${suffix} files`;
      if (options.expanded) return expandedBlock(theme, summary, output ? theme.fg("toolOutput", output) : "");
      return asText(resultLine(theme, summary, "success"));
    },
  };
}

function compactGrepRenderer(base: ReturnType<typeof createGrepToolDefinition>) {
  return {
    ...base,
    renderShell: "self" as const,
    renderCall(args: any, theme: any, context: RenderContext) {
      const pattern = typeof args?.pattern === "string" ? `/${args.pattern}/` : "/…/";
      const where = displayPath(args?.path || ".", context.cwd);
      return asText(header(theme, "Grep", `${pattern} in ${where}`, context));
    },
    renderResult(result: AgentToolResult<GrepToolDetails | undefined>, options: any, theme: any, context: RenderContext) {
      if (context.isError) return asText(resultLine(theme, oneLine(textOutput(result) || "Grep failed", 140), "error"));
      const output = textOutput(result).trim();
      const noResults = /^No matches found/m.test(output);
      const lines = output.replace(/\n\n\[[^\]]+\]$/s, "").split("\n").filter(Boolean);
      const matches = noResults ? 0 : lines.filter((line) => /^[^\n:]+:\d+:/.test(line)).length || lines.length;
      const suffix = result.details?.matchLimitReached ? "+" : "";
      const summary = matches === 0 ? "No matches" : `Found ${matches}${suffix} matches`;
      if (options.expanded) return expandedBlock(theme, summary, output ? theme.fg("toolOutput", output) : "");
      return asText(resultLine(theme, summary, "success"));
    },
  };
}

function registerCompact(pi: ExtensionAPI, cwd: string): void {
  pi.registerTool(compactReadRenderer(createReadToolDefinition(cwd)) as any);
  pi.registerTool(compactWriteRenderer(createWriteToolDefinition(cwd)) as any);
  pi.registerTool(compactEditRenderer(createEditToolDefinition(cwd)) as any);
  pi.registerTool(compactBashRenderer(createBashToolDefinition(cwd)) as any);
  pi.registerTool(compactLsRenderer(createLsToolDefinition(cwd)) as any);
  pi.registerTool(compactFindRenderer(createFindToolDefinition(cwd)) as any);
  pi.registerTool(compactGrepRenderer(createGrepToolDefinition(cwd)) as any);
}

export default function compactToolsExtension(pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    registerCompact(pi, ctx.cwd);
  });
}
