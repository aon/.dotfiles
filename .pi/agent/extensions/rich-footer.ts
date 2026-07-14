import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";

type PrInfo =
	| { state: "loading"; key: string }
	| { state: "none"; key: string }
	| { state: "found"; key: string; number: number; url: string };

function execFileText(command: string, args: string[], cwd: string): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(command, args, { cwd, timeout: 5000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
			if (error) reject(error);
			else resolve(stdout.toString());
		});
	});
}

function fmtTokens(tokens: number | null | undefined): string {
	if (typeof tokens !== "number") return "?";
	if (tokens >= 1_000_000) return `${Number.isInteger(tokens / 1_000_000) ? tokens / 1_000_000 : (tokens / 1_000_000).toFixed(1)}M`;
	if (tokens >= 1000) return `${Number.isInteger(tokens / 1000) ? tokens / 1000 : (tokens / 1000).toFixed(1)}k`;
	return `${tokens}`;
}

function fmtContext(percent: number | null | undefined, contextWindow: number | null | undefined): string {
	const pct = typeof percent === "number" ? `${Math.round(percent)}%` : "?";
	return `${pct}/${fmtTokens(contextWindow)}`;
}

function displayModel(model: { id?: string; name?: string } | undefined): string {
	if (!model) return "No model";
	if (model.name) return model.name.replace(/^Claude\s+/i, "").replace(/\s+Latest$/i, "");
	return (model.id || "No model")
		.replace(/^claude-/, "")
		.replace(/-20\d{6}$/, "")
		.replace(/-latest$/, "")
		.replace(/-/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

function link(label: string, url: string): string {
	return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
}

const ICONS_ENABLED = process.env.PI_RICH_FOOTER_ICONS !== "0";
const icons = ICONS_ENABLED
	? {
			model: "󰚩",
			effort: "󰧑",
			context: { low: "󰾆", medium: "󰾅", high: "󰓅" },
			branch: "󰘬",
			pr: "",
			none: "○",
		}
	: {
			model: "model",
			effort: "effort",
			context: { low: "ctx", medium: "ctx", high: "ctx" },
			branch: "branch",
			pr: "PR",
			none: "-",
		};

export default function (pi: ExtensionAPI) {
	let prInfo: PrInfo | null = null;
	let inFlightKey: string | null = null;

	function requestPr(cwd: string, branch: string | null, requestRender: () => void) {
		const key = `${cwd}\n${branch || ""}`;
		if (!branch) {
			prInfo = { state: "none", key };
			return;
		}
		if (prInfo?.key === key || inFlightKey === key) return;

		prInfo = { state: "loading", key };
		inFlightKey = key;
		void execFileText("gh", ["pr", "view", "--json", "number,url"], cwd)
			.then((stdout) => {
				const parsed = JSON.parse(stdout) as { number?: number; url?: string };
				if (typeof parsed.number === "number" && typeof parsed.url === "string" && parsed.url) {
					prInfo = { state: "found", key, number: parsed.number, url: parsed.url };
				} else {
					prInfo = { state: "none", key };
				}
			})
			.catch(() => {
				prInfo = { state: "none", key };
			})
			.finally(() => {
				if (inFlightKey === key) inFlightKey = null;
				requestRender();
			});
	}

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;

		ctx.ui.setFooter((tui, theme, footerData) => {
			const unsubscribe = footerData.onBranchChange(() => {
				prInfo = null;
				tui.requestRender();
			});

			return {
				dispose: unsubscribe,
				invalidate() {},
				render(width: number): string[] {
					const branch = footerData.getGitBranch();
					requestPr(ctx.cwd, branch, () => tui.requestRender());

					const usage = ctx.getContextUsage();
					const model = displayModel(ctx.model as { id?: string; name?: string } | undefined);
					const effort = pi.getThinkingLevel();
					const context = fmtContext(usage?.percent, usage?.contextWindow);
					const branchText = branch || "no-git";
					const prLabel = prInfo?.state === "found" ? `#${prInfo.number}` : prInfo?.state === "loading" ? "…" : "no PR";
					const prText = prInfo?.state === "found" ? link(prLabel, prInfo.url) : prLabel;
					const extensionStatuses = [...footerData.getExtensionStatuses().values()].filter((status) => status.length > 0);

					const effortColor = effort === "off" || effort === "minimal" ? "dim" : (`thinking${effort[0].toUpperCase()}${effort.slice(1)}` as any);
					const contextColor = typeof usage?.percent === "number" && usage.percent >= 85 ? "error" : typeof usage?.percent === "number" && usage.percent >= 60 ? "warning" : "success";
					const contextIcon = typeof usage?.percent === "number" && usage.percent >= 85 ? icons.context.high : typeof usage?.percent === "number" && usage.percent >= 60 ? icons.context.medium : icons.context.low;
					const segment = (icon: string, value: string, color: string = "accent") => `${theme.fg(color as any, icon)} ${theme.fg("muted", value)}`;
					const sep = theme.fg("dim", " · ");

					const branchWithStatuses = theme.fg("muted", branchText) + extensionStatuses.map((status) => ` ${status}`).join("");
					const branchSegment = `${theme.fg("mdLink", icons.branch)} ${branchWithStatuses}`;
					const fullParts = [
						segment(icons.model, model, "accent"),
						segment(icons.effort, effort, effortColor),
						segment(contextIcon, context, contextColor),
						branchSegment,
						segment(prInfo?.state === "found" ? icons.pr : icons.none, prText, prInfo?.state === "found" ? "success" : "dim"),
					];
					const compactParts = fullParts;
					const tinyParts = [theme.fg("muted", model), theme.fg(contextColor as any, context), branchWithStatuses, prInfo?.state === "found" ? theme.fg("success", prText) : theme.fg("dim", icons.none)];

					const fullLine = fullParts.join(sep);
					const compactLine = compactParts.join(sep);
					const tinyLine = tinyParts.join(sep);

					const chosen =
						visibleWidth(fullLine) <= width
							? fullLine
							: visibleWidth(compactLine) <= width
								? compactLine
								: tinyLine;

					return [truncateToWidth(chosen, width, "…")];
				},
			};
		});
	});
}
