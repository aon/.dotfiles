import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type {
	AgentToolResult,
	BashToolDetails,
	EditToolDetails,
	ExtensionAPI,
	ExtensionContext,
	ReadToolDetails,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	formatSize,
	getAgentDir,
	renderDiff,
} from "@earendil-works/pi-coding-agent";
import { Box, type Component, Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { TSchema } from "typebox";

const CONFIG_FILE_NAME = "compact-tool-view.json";
const SUMMARY_ENTRY_TYPE = "compact-tool-view-summary";
const LEGACY_STATUS_KEY = "compact-tool-view";
const LEGACY_WIDGET_KEY = "compact-tool-view-activity";
const VIEW_ARGUMENTS = ["compact", "full", "toggle"];
const TRACKED_TOOL_NAMES = new Set(["read", "edit", "write", "bash", "grep", "find", "ls"]);
const SUMMARY_ICONS = {
	read: "󰈙",
	edit: "󰏫",
	create: "󰝒",
	shell: "󰆍",
	search: "󰍉",
	list: "󰉋",
	failure: "󰅚",
} as const;

interface ToolActivitySummary {
	readFiles: number;
	editedFiles: number;
	createdFiles: number;
	shellRuns: number;
	searches: number;
	directoriesListed: number;
	failures: number;
}

interface ActiveToolActivity {
	readFiles: Set<string>;
	editedFiles: Set<string>;
	createdFiles: Set<string>;
	shellRuns: number;
	searches: number;
	directoriesListed: number;
	failures: number;
}

interface PendingToolActivity {
	toolName: string;
	path?: string;
	writeExisted?: boolean;
}

interface CompactRendererState<TState> {
	baseState: TState;
	shell?: Box;
	callComponent?: Component;
	resultComponent?: Component;
}

interface FullRenderStatus {
	isError: boolean;
	isPartial: boolean;
}

interface BashTiming {
	startedAt?: number;
	endedAt?: number;
	interval?: ReturnType<typeof setInterval>;
}

type ToolArguments = Record<string, unknown>;
type RenderTheme = Parameters<NonNullable<ToolDefinition["renderCall"]>>[1];

type BuiltInDefinitionFactory<TParams extends TSchema, TDetails, TState> = (
	cwd: string,
) => ToolDefinition<TParams, TDetails, TState>;

export default function compactToolViewExtension(pi: ExtensionAPI) {
	const configPath = join(getAgentDir(), CONFIG_FILE_NAME);
	let compactMode = false;
	let activeActivity: ActiveToolActivity | undefined;
	const pendingTools = new Map<string, PendingToolActivity>();

	const refreshPendingActivity = (toolCallId: string, toolName: string, args: unknown, cwd: string): void => {
		pendingTools.set(toolCallId, createPendingActivity(toolName, args, cwd));
	};
	registerCompactableTool(pi, createFullReadToolDefinition, () => compactMode, refreshPendingActivity);
	registerCompactableTool(pi, createFullEditToolDefinition, () => compactMode, refreshPendingActivity);
	registerCompactableTool(pi, createFullWriteToolDefinition, () => compactMode, refreshPendingActivity);
	registerCompactableTool(pi, createFullBashToolDefinition, () => compactMode, refreshPendingActivity);
	registerCompactableTool(pi, createFullGrepToolDefinition, () => compactMode, refreshPendingActivity);
	registerCompactableTool(pi, createFullFindToolDefinition, () => compactMode, refreshPendingActivity);
	registerCompactableTool(pi, createFullLsToolDefinition, () => compactMode, refreshPendingActivity);

	pi.registerEntryRenderer<ToolActivitySummary>(SUMMARY_ENTRY_TYPE, (entry, options, theme) => {
		if (!compactMode || options.expanded || !entry.data) {
			return undefined;
		}

		return new Text(formatOutcomeSummary(theme, entry.data), 0, 0);
	});

	pi.registerCommand("tool-view", {
		description: "Toggle compact aggregate tool output",
		getArgumentCompletions: (prefix) => {
			const matches = VIEW_ARGUMENTS.filter((argument) => argument.startsWith(prefix)).map((argument) => ({
				value: argument,
				label: argument,
			}));
			return matches.length > 0 ? matches : null;
		},
		handler: async (args, ctx) => {
			const requestedMode = args.trim().toLowerCase();
			if (requestedMode && !VIEW_ARGUMENTS.includes(requestedMode)) {
				ctx.ui.notify("Usage: /tool-view [compact|full|toggle]", "error");
				return;
			}

			const nextCompactMode = requestedMode === "compact" ? true : requestedMode === "full" ? false : !compactMode;
			try {
				saveMode(configPath, nextCompactMode);
			} catch (error) {
				ctx.ui.notify(`Could not save tool view: ${error instanceof Error ? error.message : String(error)}`, "error");
				return;
			}

			compactMode = nextCompactMode;
			if (compactMode && activeActivity) {
				showWorkingSummary(ctx, activeActivity, pendingTools);
			} else {
				ctx.ui.setWorkingMessage();
			}
			refreshTranscript(ctx);
			ctx.ui.notify(`Tool view: ${compactMode ? "compact" : "full"}`, "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		compactMode = loadMode(configPath);
		activeActivity = undefined;
		pendingTools.clear();
		ctx.ui.setWorkingMessage();
		ctx.ui.setStatus(LEGACY_STATUS_KEY, undefined);
		ctx.ui.setWidget(LEGACY_WIDGET_KEY, undefined);
	});

	pi.on("agent_start", () => {
		activeActivity ??= createActiveActivity();
	});

	pi.on("tool_execution_start", (event, ctx) => {
		if (!TRACKED_TOOL_NAMES.has(event.toolName)) {
			return;
		}

		activeActivity ??= createActiveActivity();
		pendingTools.set(event.toolCallId, createPendingActivity(event.toolName, event.args, ctx.cwd));
		if (compactMode) {
			showWorkingSummary(ctx, activeActivity, pendingTools);
		}
	});

	pi.on("tool_execution_end", (event, ctx) => {
		const pending = pendingTools.get(event.toolCallId);
		if (!pending || !activeActivity) {
			return;
		}

		pendingTools.delete(event.toolCallId);
		if (event.isError) {
			activeActivity.failures += 1;
		} else {
			commitToolActivity(activeActivity, pending);
		}
		if (compactMode) {
			showWorkingSummary(ctx, activeActivity, pendingTools);
		}
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (activeActivity) {
			const summary = snapshotActivity(activeActivity);
			if (hasActivity(summary)) {
				pi.appendEntry<ToolActivitySummary>(SUMMARY_ENTRY_TYPE, summary);
			}
		}

		activeActivity = undefined;
		pendingTools.clear();
		ctx.ui.setWorkingMessage();
	});
}

function registerCompactableTool<TParams extends TSchema, TDetails, TState>(
	pi: ExtensionAPI,
	createDefinition: BuiltInDefinitionFactory<TParams, TDetails, TState>,
	isCompact: () => boolean,
	onExecute: (toolCallId: string, toolName: string, args: unknown, cwd: string) => void,
): void {
	const definitions = new Map<string, ToolDefinition<TParams, TDetails, TState>>();
	const getDefinition = (cwd: string): ToolDefinition<TParams, TDetails, TState> => {
		let definition = definitions.get(cwd);
		if (!definition) {
			definition = createDefinition(cwd);
			definitions.set(cwd, definition);
		}
		return definition;
	};
	const initialDefinition = getDefinition(process.cwd());
	const compactableDefinition: ToolDefinition<TParams, TDetails, CompactRendererState<TState>> = {
		...initialDefinition,
		renderShell: "self",
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			onExecute(toolCallId, initialDefinition.name, params, ctx.cwd);
			return getDefinition(ctx.cwd).execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall(args, theme, context) {
			if (isCompact() && !context.expanded) {
				return new Container();
			}

			const definition = getDefinition(context.cwd);
			context.state.baseState ??= {} as TState;
			const baseContext = {
				...context,
				state: context.state.baseState,
				lastComponent: context.state.callComponent,
			};
			const component = definition.renderCall?.(args, theme, baseContext) ?? new Text(theme.fg("toolTitle", theme.bold(definition.name)), 0, 0);
			context.state.callComponent = component;

			if (definition.renderShell === "self") {
				return component;
			}

			const shell = context.state.shell ?? new Box(1, 1, getToolBackground(theme, context));
			shell.setBgFn(getToolBackground(theme, context));
			shell.clear();
			shell.addChild(component);
			context.state.shell = shell;
			return shell;
		},
		renderResult(result, options, theme, context) {
			if (isCompact() && !options.expanded) {
				return new Container();
			}

			const definition = getDefinition(context.cwd);
			context.state.baseState ??= {} as TState;
			const baseContext = {
				...context,
				state: context.state.baseState,
				lastComponent: context.state.resultComponent,
			};
			const component = definition.renderResult?.(result, options, theme, baseContext);
			context.state.resultComponent = component;

			if (definition.renderShell === "self") {
				return component ?? new Container();
			}

			const shell = context.state.shell;
			if (shell && component) {
				shell.setBgFn(getToolBackground(theme, context));
				shell.addChild(component);
			}
			return new Container();
		},
	};

	pi.registerTool(compactableDefinition);
}

function createFullReadToolDefinition(cwd: string): ReturnType<typeof createReadToolDefinition> {
	const base = createReadToolDefinition(cwd);
	return {
		...base,
		renderShell: "self",
		renderCall(args, theme, context) {
			const toolArguments = asArguments(args);
			return asText(header(theme, "Read", displayPath(toolArguments.path ?? toolArguments.file_path, context.cwd), context));
		},
		renderResult(result, options, theme, context) {
			if (context.isError) {
				return asText(resultLine(theme, oneLine(textOutput(result) || "Read failed", 140), "error"));
			}
			if (options.expanded) {
				const expanded = base.renderResult?.(result, options, theme, context);
				const container = new Container();
				container.addChild(asText(resultLine(theme, readSummary(result, asArguments(context.args)), "success")));
				if (expanded) {
					container.addChild(expanded);
				}
				return container;
			}
			return asText(resultLine(theme, readSummary(result, asArguments(context.args)), "success"));
		},
	};
}

function createFullEditToolDefinition(cwd: string): ReturnType<typeof createEditToolDefinition> {
	const base = createEditToolDefinition(cwd);
	return {
		...base,
		renderShell: "self",
		renderCall(args, theme, context) {
			const toolArguments = asArguments(args);
			return asText(header(theme, "Edit", displayPath(toolArguments.path ?? toolArguments.file_path, context.cwd), context));
		},
		renderResult(result, options, theme, context) {
			if (context.isError) {
				return asText(resultLine(theme, oneLine(textOutput(result) || "Edit failed", 160), "error"));
			}
			const summary = editSummary(asArguments(context.args), result);
			if (options.expanded && result.details?.diff) {
				return expandedBlock(theme, summary, renderDiff(result.details.diff));
			}
			return asText(resultLine(theme, summary, "success"));
		},
	};
}

function createFullWriteToolDefinition(cwd: string): ReturnType<typeof createWriteToolDefinition> {
	const base = createWriteToolDefinition(cwd);
	return {
		...base,
		renderShell: "self",
		renderCall(args, theme, context) {
			const toolArguments = asArguments(args);
			return asText(header(theme, "Write", displayPath(toolArguments.path ?? toolArguments.file_path, context.cwd), context));
		},
		renderResult(result, options, theme, context) {
			const toolArguments = asArguments(context.args);
			if (context.isError) {
				return asText(resultLine(theme, oneLine(textOutput(result) || "Write failed", 140), "error"));
			}
			if (options.expanded && typeof toolArguments.content === "string") {
				return expandedBlock(theme, writeSummary(toolArguments), theme.fg("toolOutput", toolArguments.content));
			}
			return asText(resultLine(theme, writeSummary(toolArguments), "success"));
		},
	};
}

function createFullBashToolDefinition(cwd: string): ReturnType<typeof createBashToolDefinition> {
	const base = createBashToolDefinition(cwd);
	const timings = new Map<string, BashTiming>();
	return {
		...base,
		renderShell: "self",
		renderCall(args, theme, context) {
			const timing = timings.get(context.toolCallId) ?? {};
			if (context.executionStarted && timing.startedAt === undefined) {
				timing.startedAt = Date.now();
				timing.endedAt = undefined;
				timings.set(context.toolCallId, timing);
			}
			const command = stringArgument(asArguments(args).command) || "…";
			return {
				render(width: number) {
					return [truncateToWidth(header(theme, "Bash", oneLine(command, Math.max(24, width - 12)), context), width, "…")];
				},
				invalidate() {},
			};
		},
		renderResult(result, options, theme, context) {
			const timing = timings.get(context.toolCallId) ?? {};
			if (timing.startedAt !== undefined && options.isPartial && !timing.interval) {
				timing.interval = setInterval(() => context.invalidate(), 1000);
			}
			if (!options.isPartial || context.isError) {
				timing.endedAt ??= Date.now();
				if (timing.interval) {
					clearInterval(timing.interval);
					timing.interval = undefined;
				}
			}
			timings.set(context.toolCallId, timing);

			const summary = bashSummary(result, context, timing);
			if (options.expanded) {
				const output = textOutput(result).trim();
				const body = output && output !== "(no output)" ? theme.fg("toolOutput", output) : "";
				return expandedBlock(theme, summary, body);
			}
			return asText(resultLine(theme, summary, context.isError ? "error" : options.isPartial ? "muted" : "success"));
		},
	};
}

function createFullGrepToolDefinition(cwd: string): ReturnType<typeof createGrepToolDefinition> {
	const base = createGrepToolDefinition(cwd);
	return {
		...base,
		renderShell: "self",
		renderCall(args, theme, context) {
			const toolArguments = asArguments(args);
			const pattern = stringArgument(toolArguments.pattern);
			const where = displayPath(toolArguments.path || ".", context.cwd);
			return asText(header(theme, "Grep", `/${pattern || "…"}/ in ${where}`, context));
		},
		renderResult(result, options, theme, context) {
			if (context.isError) {
				return asText(resultLine(theme, oneLine(textOutput(result) || "Grep failed", 140), "error"));
			}
			const output = textOutput(result).trim();
			const noResults = /^No matches found/m.test(output);
			const lines = output.replace(/\n\n\[[^\]]+\]$/s, "").split("\n").filter(Boolean);
			const matches = noResults ? 0 : lines.filter((line) => /^[^\n:]+:\d+:/.test(line)).length || lines.length;
			const suffix = result.details?.matchLimitReached ? "+" : "";
			const summary = matches === 0 ? "No matches" : `Found ${matches}${suffix} matches`;
			if (options.expanded) {
				return expandedBlock(theme, summary, output ? theme.fg("toolOutput", output) : "");
			}
			return asText(resultLine(theme, summary, "success"));
		},
	};
}

function createFullFindToolDefinition(cwd: string): ReturnType<typeof createFindToolDefinition> {
	const base = createFindToolDefinition(cwd);
	return {
		...base,
		renderShell: "self",
		renderCall(args, theme, context) {
			const toolArguments = asArguments(args);
			const pattern = stringArgument(toolArguments.pattern) || "…";
			const where = displayPath(toolArguments.path || ".", context.cwd);
			return asText(header(theme, "Find", `${pattern} in ${where}`, context));
		},
		renderResult(result, options, theme, context) {
			if (context.isError) {
				return asText(resultLine(theme, oneLine(textOutput(result) || "Find failed", 140), "error"));
			}
			const output = textOutput(result).trim();
			const noResults = /^No files found/m.test(output);
			const count = noResults ? 0 : lineCount(output.replace(/\n\n\[[^\]]+\]$/s, ""));
			const suffix = result.details?.resultLimitReached ? "+" : "";
			const summary = count === 0 ? "No files found" : `Found ${count}${suffix} files`;
			if (options.expanded) {
				return expandedBlock(theme, summary, output ? theme.fg("toolOutput", output) : "");
			}
			return asText(resultLine(theme, summary, "success"));
		},
	};
}

function createFullLsToolDefinition(cwd: string): ReturnType<typeof createLsToolDefinition> {
	const base = createLsToolDefinition(cwd);
	return {
		...base,
		renderShell: "self",
		renderCall(args, theme, context) {
			const toolArguments = asArguments(args);
			return asText(header(theme, "List", displayPath(toolArguments.path || ".", context.cwd), context));
		},
		renderResult(result, options, theme, context) {
			if (context.isError) {
				return asText(resultLine(theme, oneLine(textOutput(result) || "List failed", 140), "error"));
			}
			const output = textOutput(result).trim();
			const count = output === "(empty directory)" ? 0 : lineCount(output.replace(/\n\n\[[^\]]+\]$/s, ""));
			const suffix = result.details?.entryLimitReached ? "+" : "";
			const summary = count === 0 ? "Empty directory" : `Listed ${count}${suffix} entries`;
			if (options.expanded) {
				return expandedBlock(theme, summary, output ? theme.fg("toolOutput", output) : "");
			}
			return asText(resultLine(theme, summary, "success"));
		},
	};
}

function header(theme: RenderTheme, action: string, target: string, context: FullRenderStatus): string {
	return `${theme.fg(markerColor(context), "●")} ${theme.fg("toolTitle", theme.bold(action))} ${theme.fg("accent", target)}`;
}

function markerColor(context: FullRenderStatus): "success" | "error" | "muted" {
	if (context.isError) {
		return "error";
	}
	if (context.isPartial) {
		return "muted";
	}
	return "success";
}

function resultLine(theme: RenderTheme, summary: string, _kind: "success" | "error" | "muted"): string {
	return `  ${theme.fg("dim", "└─")} ${theme.fg("dim", summary)}`;
}

function expandedBlock(theme: RenderTheme, title: string, body: string): Container {
	const container = new Container();
	container.addChild(asText(resultLine(theme, title, "muted")));
	if (body) {
		container.addChild(asText(`\n${body}`));
	}
	return container;
}

function readSummary(result: AgentToolResult<ReadToolDetails | undefined>, args: ToolArguments): string {
	const truncation = result.details?.truncation;
	if (truncation?.truncated) {
		return `Read ${truncation.outputLines} of ${truncation.totalLines} lines`;
	}

	const output = textOutput(result);
	if (/^Read image file/m.test(output)) {
		return output.split("\n")[0] ?? "Read image";
	}

	const explicitLimit = typeof args.limit === "number" ? args.limit : undefined;
	const count = lineCount(output.replace(/\n\n\[[^\]]+\]$/s, ""));
	return `Read ${plural(explicitLimit ? Math.min(explicitLimit, count || explicitLimit) : count, "line")}`;
}

function editSummary(args: ToolArguments, result: AgentToolResult<EditToolDetails | undefined>): string {
	const edits = Array.isArray(args.edits) ? args.edits.length : args.oldText && args.newText ? 1 : 0;
	const stats = diffStats(result.details?.diff);
	const parts = [plural(edits, "replacement")];
	if (stats.added || stats.removed) {
		parts.push(`+${stats.added} -${stats.removed}`);
	}
	return parts.join(" · ");
}

function writeSummary(args: ToolArguments): string {
	const content = stringArgument(args.content);
	return `Wrote ${formatSize(Buffer.byteLength(content, "utf8"))} · ${plural(lineCount(content), "line")}`;
}

function bashSummary(
	result: AgentToolResult<BashToolDetails | undefined>,
	context: FullRenderStatus,
	timing: BashTiming,
): string {
	const output = textOutput(result).trim();
	const truncation = result.details?.truncation;
	const lines = truncation?.totalLines ?? lineCount(output === "(no output)" ? "" : output);
	const elapsed = timing.startedAt
		? `${(((timing.endedAt ?? Date.now()) - timing.startedAt) / 1000).toFixed(1)}s`
		: undefined;

	if (context.isPartial) {
		return ["Running", elapsed, lines ? plural(lines, "line") : undefined].filter(Boolean).join(" · ");
	}
	if (context.isError) {
		const lastLine = output.split("\n").filter(Boolean).at(-1) ?? "Command failed";
		return [oneLine(lastLine, 72), elapsed, lines ? plural(lines, "line") : undefined].filter(Boolean).join(" · ");
	}
	return ["Exit 0", elapsed, lines ? plural(lines, "line") : "no output"].filter(Boolean).join(" · ");
}

function textOutput<TDetails>(result: AgentToolResult<TDetails> | undefined): string {
	if (!result) {
		return "";
	}
	return result.content
		.map((part) => {
			if (part.type === "text") {
				return part.text;
			}
			return `[image${part.mimeType ? `: ${part.mimeType}` : ""}]`;
		})
		.filter(Boolean)
		.join("\n");
}

function displayPath(raw: unknown, cwd: string): string {
	const path = stringArgument(raw);
	if (!path) {
		return "…";
	}
	if (!isAbsolute(path)) {
		return path;
	}
	const relativePath = relative(cwd, path);
	return relativePath && !relativePath.startsWith("..") ? relativePath : path;
}

function oneLine(value: string, max = 96): string {
	const compact = value.replace(/\s+/g, " ").trim();
	return compact.length > max ? `${compact.slice(0, Math.max(0, max - 1))}…` : compact;
}

function lineCount(text: string): number {
	if (!text) {
		return 0;
	}
	const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
	return trimmed ? trimmed.split("\n").length : 0;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
	return `${count} ${count === 1 ? singular : pluralForm}`;
}

function diffStats(diff: string | undefined): { added: number; removed: number } {
	if (!diff) {
		return { added: 0, removed: 0 };
	}
	let added = 0;
	let removed = 0;
	for (const line of diff.split("\n")) {
		if (/^\+\s*\d*\s/.test(line) || /^\+[^+]/.test(line)) {
			added += 1;
		} else if (/^-\s*\d*\s/.test(line) || /^-[^-]/.test(line)) {
			removed += 1;
		}
	}
	return { added, removed };
}

function asText(text: string): Text {
	return new Text(text, 0, 0);
}

function asArguments(value: unknown): ToolArguments {
	return value && typeof value === "object" ? (value as ToolArguments) : {};
}

function stringArgument(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function getToolBackground(
	theme: RenderTheme,
	context: Parameters<NonNullable<ToolDefinition["renderCall"]>>[2],
): (text: string) => string {
	if (context.isPartial) {
		return (text) => theme.bg("toolPendingBg", text);
	}
	if (context.isError) {
		return (text) => theme.bg("toolErrorBg", text);
	}
	return (text) => theme.bg("toolSuccessBg", text);
}

function loadMode(configPath: string): boolean {
	try {
		const data = JSON.parse(readFileSync(configPath, "utf8")) as { compact?: unknown };
		return typeof data.compact === "boolean" ? data.compact : false;
	} catch {
		return false;
	}
}

function saveMode(configPath: string, compact: boolean): void {
	writeFileSync(configPath, `${JSON.stringify({ compact }, null, 2)}\n`, "utf8");
}

function refreshTranscript(ctx: ExtensionContext): void {
	const expanded = ctx.ui.getToolsExpanded();
	ctx.ui.setToolsExpanded(!expanded);
	ctx.ui.setToolsExpanded(expanded);
}

function createActiveActivity(): ActiveToolActivity {
	return {
		readFiles: new Set(),
		editedFiles: new Set(),
		createdFiles: new Set(),
		shellRuns: 0,
		searches: 0,
		directoriesListed: 0,
		failures: 0,
	};
}

function createPendingActivity(toolName: string, args: unknown, cwd: string): PendingToolActivity {
	const path = readPath(args);
	return {
		toolName,
		path,
		writeExisted: toolName === "write" && path !== undefined ? existsSync(resolve(cwd, path)) : undefined,
	};
}

function commitToolActivity(activity: ActiveToolActivity, pending: PendingToolActivity): void {
	switch (pending.toolName) {
		case "read":
			addPath(activity.readFiles, pending.path);
			break;
		case "edit":
			addPath(activity.editedFiles, pending.path);
			break;
		case "write":
			addPath(pending.writeExisted ? activity.editedFiles : activity.createdFiles, pending.path);
			break;
		case "bash":
			activity.shellRuns += 1;
			break;
		case "grep":
		case "find":
			activity.searches += 1;
			break;
		case "ls":
			activity.directoriesListed += 1;
			break;
	}
}

function showWorkingSummary(
	ctx: ExtensionContext,
	activity: ActiveToolActivity,
	pendingTools: ReadonlyMap<string, PendingToolActivity>,
): void {
	const summary = snapshotActivityWithPending(activity, pendingTools);
	ctx.ui.setWorkingMessage(`Working...  ${formatOutcomeSummary(ctx.ui.theme, summary)}`);
}

function snapshotActivityWithPending(
	activity: ActiveToolActivity,
	pendingTools: ReadonlyMap<string, PendingToolActivity>,
): ToolActivitySummary {
	const liveActivity: ActiveToolActivity = {
		readFiles: new Set(activity.readFiles),
		editedFiles: new Set(activity.editedFiles),
		createdFiles: new Set(activity.createdFiles),
		shellRuns: activity.shellRuns,
		searches: activity.searches,
		directoriesListed: activity.directoriesListed,
		failures: activity.failures,
	};
	for (const pending of pendingTools.values()) {
		commitToolActivity(liveActivity, pending);
	}
	return snapshotActivity(liveActivity);
}

function snapshotActivity(activity: ActiveToolActivity): ToolActivitySummary {
	return {
		readFiles: activity.readFiles.size,
		editedFiles: activity.editedFiles.size,
		createdFiles: activity.createdFiles.size,
		shellRuns: activity.shellRuns,
		searches: activity.searches,
		directoriesListed: activity.directoriesListed,
		failures: activity.failures,
	};
}

function formatOutcomeSummary(theme: RenderTheme, summary: ToolActivitySummary): string {
	const segments: string[] = [];
	pushOutcome(segments, theme, SUMMARY_ICONS.read, summary.readFiles, "read");
	pushOutcome(segments, theme, SUMMARY_ICONS.edit, summary.editedFiles, "changed");
	pushOutcome(segments, theme, SUMMARY_ICONS.create, summary.createdFiles, "new");
	pushOutcome(segments, theme, SUMMARY_ICONS.shell, summary.shellRuns, "ran");
	pushOutcome(segments, theme, SUMMARY_ICONS.search, summary.searches, "found");
	pushOutcome(segments, theme, SUMMARY_ICONS.list, summary.directoriesListed, "listed");
	pushOutcome(segments, theme, SUMMARY_ICONS.failure, summary.failures, "failed");
	return segments.join(theme.fg("dim", "  "));
}

function pushOutcome(
	segments: string[],
	theme: RenderTheme,
	icon: string,
	count: number,
	outcome: string,
): void {
	if (count > 0) {
		segments.push(`${theme.fg("dim", icon)} ${theme.fg("muted", `${count} ${outcome}`)}`);
	}
}

function hasActivity(summary: ToolActivitySummary): boolean {
	return Object.values(summary).some((count) => count > 0);
}

function readPath(args: unknown): string | undefined {
	if (typeof args !== "object" || args === null || !("path" in args)) {
		return undefined;
	}
	const path = (args as { path?: unknown }).path;
	return typeof path === "string" ? path : undefined;
}

function addPath(paths: Set<string>, path: string | undefined): void {
	if (path !== undefined) {
		paths.add(path);
	}
}
