import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_ID = "git-diff";
const REFRESH_INTERVAL_MS = 2000;

export default function (pi: ExtensionAPI) {
	let refreshTimer: ReturnType<typeof setInterval> | undefined;
	let lastStatus: string | undefined;
	let refreshing = false;

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) {
			return;
		}

		await refreshGitDiffStatus(pi, ctx, (status) => {
			lastStatus = setGitDiffStatus(ctx, status, lastStatus);
		});

		refreshTimer = setInterval(() => {
			if (refreshing) {
				return;
			}

			refreshing = true;
			void refreshGitDiffStatus(pi, ctx, (status) => {
				lastStatus = setGitDiffStatus(ctx, status, lastStatus);
			}).finally(() => {
				refreshing = false;
			});
		}, REFRESH_INTERVAL_MS);
	});

	pi.on("turn_end", async (_event, ctx) => {
		if (!ctx.hasUI) {
			return;
		}

		await refreshGitDiffStatus(pi, ctx, (status) => {
			lastStatus = setGitDiffStatus(ctx, status, lastStatus);
		});
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (refreshTimer) {
			clearInterval(refreshTimer);
			refreshTimer = undefined;
		}
		if (ctx.hasUI) {
			ctx.ui.setStatus(STATUS_ID, undefined);
		}
		lastStatus = undefined;
		refreshing = false;
	});
}

async function refreshGitDiffStatus(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	setStatus: (status: GitDiffStatus | undefined) => void,
) {
	const insideWorkTree = await pi.exec("git", ["-C", ctx.cwd, "rev-parse", "--is-inside-work-tree"], {
		timeout: 1000,
	});

	if (insideWorkTree.code !== 0 || insideWorkTree.stdout.trim() !== "true") {
		setStatus(undefined);
		return;
	}

	let diff = await pi.exec("git", ["-C", ctx.cwd, "diff", "--numstat", "HEAD", "--"], {
		timeout: 2000,
	});

	if (diff.code !== 0) {
		diff = await pi.exec("git", ["-C", ctx.cwd, "diff", "--numstat", "--"], { timeout: 2000 });
	}

	if (diff.code !== 0) {
		setStatus(undefined);
		return;
	}

	setStatus(parseNumstat(diff.stdout));
}

function parseNumstat(output: string): GitDiffStatus {
	let added = 0;
	let removed = 0;

	for (const line of output.split("\n")) {
		if (!line.trim()) {
			continue;
		}

		const [addedText, removedText] = line.split("\t");
		const fileAdded = Number.parseInt(addedText ?? "", 10);
		const fileRemoved = Number.parseInt(removedText ?? "", 10);

		if (Number.isFinite(fileAdded)) {
			added += fileAdded;
		}
		if (Number.isFinite(fileRemoved)) {
			removed += fileRemoved;
		}
	}

	return { added, removed };
}

function setGitDiffStatus(
	ctx: ExtensionContext,
	status: GitDiffStatus | undefined,
	lastStatus: string | undefined,
) {
	const nextStatus = status ? formatGitDiffStatus(ctx, status) : undefined;
	if (nextStatus === lastStatus) {
		return lastStatus;
	}

	ctx.ui.setStatus(STATUS_ID, nextStatus);
	return nextStatus;
}

function formatGitDiffStatus(ctx: ExtensionContext, status: GitDiffStatus) {
	const text = `(+${status.added},-${status.removed})`;
	if (status.added === 0 && status.removed === 0) {
		return ctx.ui.theme.fg("dim", text);
	}
	return ctx.ui.theme.fg("success", `(+${status.added},`) + ctx.ui.theme.fg("error", `-${status.removed})`);
}

type GitDiffStatus = {
	added: number;
	removed: number;
};
