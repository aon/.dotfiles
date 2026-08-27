---
name: delegate-to-worktree
description: >-
  Hand a task off to a fresh coding agent running in its own Orca worktree, which carries it to a
  green PR — either as an architect that decomposes the work, dispatches implementers, reviews every
  stage and opens the PR, or, for small fully-specified changes, by writing the diff itself and
  running the `pr` skill. Use when the user says
  "delegate this to a worktree", "delegá esto a un worktree", "trabajemos esto en un worktree",
  "creá un worktree por orca", "que lo trabaje otro agente", "delegate to work tree", or when a
  triage / review / planning session surfaces work that should not be implemented inline. This is a
  full handoff: you write the brief and stop — you do not implement and you do not babysit.
---

# Delegate to Worktree

Turn a task from the current conversation into an independent worker: an Orca-managed checkout on
its own branch, with a fresh agent inside it that carries the task to completion.

The value of this skill is **the brief**, not the commands. The delegated agent gets none of this
conversation — every fact it needs must be written down before you launch it.

## Do not use this when

- The change is a one-liner in the current checkout and the user is watching.
- The user asked *you* to do it here, or asked to supervise / monitor / coordinate several
  agents. Supervised orchestration is a different tool (`orca orchestration ...`); this skill is a
  one-way handoff.
- The work depends on uncommitted changes in the current checkout. Commit or stash them first, or
  capture `git diff` into a file and reference that file from the brief — a new worktree starts
  from the base branch and sees none of your working tree.

## 1. Resolve the CLI and the repo

Follow the `orca-cli` skill to pick the executable for this session. Confirm the runtime once:

```text
orca status --json
```

Identify the repo root of the work (usually the current working directory's repo). You address it
as `path:<abs-repo-root>` — no need to look up the repo id.

## 2. Pick the mode

The delegated agent reaches a green PR one of two ways. Pick before writing the brief — the
template you copy depends on it.

**Direct** (`brief-template-direct.md`) — the agent writes the diff itself, verifies, commits, and
runs the `pr` skill. Use it when the change is small and already fully specified: toolchain and CI
config, a rename, a copy change, a dependency bump, a one-file fix.

**Architect** (`brief-template-architect.md`) — the agent follows the repo's
`implement-with-architect` skill: it decomposes the task by data dependency, dispatches one
implementer per stage, reviews and commits every stage, then verifies, runs `code-review --fix` and
opens the PR. Use it for anything with real implementation freedom: a feature, a behavior change, a
bug whose cause is not located yet, a change spanning several apps or packages.

The test: **if the Scope you are about to write already spells out the diff — every file, and what
it becomes — there is nothing left for an architect to decide, so go direct.** If you find yourself
writing "figure out where X happens and change it", that is architect work.

Architect mode reads `.claude/skills/implement-with-architect/SKILL.md` from inside the worktree, so
it only exists in repos that carry that skill — `afippi` does. In a repo that does not, go direct or
say so instead of pointing the brief at a file that is not there.

Both modes are Claude-only (subagents with pinned models and the `pr` skill are both Claude Code's),
and both end at the same place: a PR with CI green, opened by the delegated agent, not by you.

## 3. Write the brief before creating anything

Write it to a file in the scratchpad directory, e.g. `<scratchpad>/brief-<slug>.md`, copying the
template for the mode you picked. A brief is complete when a competent stranger could finish the
task from it alone.

Required, in this order:

1. **Task** — one sentence, imperative.
2. **Context** — why this exists: the incident, the review finding, the user request. Include issue
   / PR numbers, Sentry short-ids, file paths and symbol names you already located. Reference
   artifacts by path or URL instead of pasting them.
3. **Scope** — what to change, and an explicit **out of scope** list. Everything you deliberately
   decided not to do belongs here; otherwise the agent rediscovers and re-litigates it.
4. **Acceptance criteria** — observable outcomes, not implementation steps.
5. **Closing steps** — report the outcome verbatim (the PR link and CI result, or where it stopped),
   then set the worktree comment.

Prefer paths and commands over prose. Never write "as we discussed".

Exactly one of the two must open the pull request. In architect mode the brief tells the agent
**not** to invoke the `pr` skill itself, because the architect's closing dispatches a subagent that
does; in direct mode the `pr` skill is the only thing that does. Both templates already say so — do
not soften either.

Task, Scope and out-of-scope carry the weight in both modes: in architect mode they are decomposed
into stage briefs whose implementers never see the original, and in direct mode they are the whole
instruction. Test each the way the agent will read it: a Task with an "and" joining two different
things is two tasks,
and a Scope a stranger could not act on is not a scope. If one comes out vague, that is the one to
ask about before launching — a delegated agent cannot ask anything itself.

## 4. Create the worktree with the agent in it

One command creates the checkout and launches the agent in its first terminal. Local `main` is
frequently behind and Orca bases new worktrees on the *local* ref, so fetch first and pass the
remote ref explicitly:

```text
git -C <abs-repo-root> fetch origin
orca worktree create --repo path:<abs-repo-root> --name <branch-slug> --base-branch origin/main \
  --no-parent --agent claude --prompt "Leé <abs-brief-path> y ejecutá la tarea completa de punta a punta." --json
```

- **`--agent claude`, always.** Both modes lean on Claude Code machinery the brief names by hand:
  the `Agent` tool and the repo skill in architect mode, the `pr` skill in direct mode. A Codex
  worker has neither and will improvise, silently skipping the review and the CI gate. If the user
  asks for Codex, say that first: it is a different job, not a different flag. The launch line is
  `claude '--dangerously-skip-permissions' '<prompt>'` — Orca launches it already bypassing
  approvals, so a delegated agent never stalls on a permission prompt with nobody there to answer.
- **Keep `--prompt` to one line that points at the brief file.** Orca passes it as a single quoted
  argv element, so a multi-line brief with code snippets in it is at the mercy of that quoting;
  a one-line pointer is immune and reads the same for either agent. Inline the whole brief only for
  a throwaway task with no code in it.
- `--name` becomes the branch name: use the conventional-commit style the repo uses
  (`fix-...`, `feat-...`) or a short kebab-case slug.
- `--no-parent` because a delegated task is independent work, not stacked on the current branch.
  Drop it only when the user asks for stacked work.
- From the response keep `result.worktree.id` (the full `<repoId>::<path>`),
  `result.worktree.path`, and `result.agentTerminalHandle` (older runtimes return only
  `result.startupTerminal.handle`). That is the one agent handle — if it later returns
  `terminal_handle_stale`, re-acquire with `orca terminal list --worktree path:<worktree-path> --json`.

Verify the base actually landed, and correct it if not:

```text
git -C <worktree-path> log --oneline -1
git -C <worktree-path> reset --hard origin/main
```

Repo setup hooks (in `afippi`: copy `apps/*/.env`, then `pnpm install`) run in their own terminal
alongside the agent and may still be going when it starts. That is fine, and the brief assumes it —
do not make the agent re-run `pnpm install` as a ritual first step. Pass `--setup skip` only for a
probe or a task that never runs the code; if you do, say so in the brief, because then nothing has
installed anything.

### When the agent needs custom flags

This is the escape hatch for a worker that is not Claude. Rewrite the brief's `Ejecución` and
`Cierre` sections first: neither the `implement-with-architect` skill nor the `pr` skill exists for
that agent, so leaving them in means handing it instructions it cannot follow. Spell out commit, push and
`gh pr create` by hand instead.

`--agent` launches the agent's default command line and accepts no extra argv, so a request like
"usá codex con gpt-5.5 en xhigh" needs the two-step path instead: create the worktree bare, then

```text
orca terminal create --worktree path:<worktree-path> --title <SLUG> \
  --command 'codex --model gpt-5.5 -c model_reasoning_effort="xhigh" "$(cat <abs-brief-path>)"' --json
```

Single-quote the outer command so the worktree's shell expands `$(cat ...)`. This path can leave an
extra startup shell next to the agent when the repo has no default terminal tabs configured; close
it only after `orca terminal list` confirms it is an unused shell. Use it only when the flags are
the point — otherwise `--agent` is the shorter, cleaner path.

## 5. Confirm, label, and let go

Read the buffer once to confirm the agent actually started on the brief (the text is at
`result.terminal.tail`; there is no `terminal output` command):

```text
orca terminal read --terminal <handle> --json
orca worktree set --worktree id:<repoId>::<worktree-path> --comment "delegado: <task>" --workspace-status in-progress --json
```

Then report to the user, in one short paragraph: what was delegated, to which agent, the branch, the
worktree path, the terminal handle, and the brief's path. Stop there — no polling loops, no waiting.
The delegated agent opens the PR itself.

Only if the user later asks how it is going:

```text
orca terminal read --terminal <handle> --json
orca worktree show --worktree id:<repoId>::<worktree-path> --json
orca terminal send --terminal <handle> --text "<follow-up>" --enter --json
```

## Delegating several tasks at once

One worktree, one branch, one agent per task, with distinct `--name` slugs. Do not put two tasks in
one brief — they collide in one branch and one PR. Create them in sequence, report all handles
together at the end.

## Gotchas

- **Stale local base.** Covered in step 4; skipping the fetch produces a PR full of unrelated
  reverts.
- **`pnpm install` short-circuits in fresh worktrees.** `pnpm check` fails with
  `Cannot find module` for a dependency that *is* in `package.json`. Both templates already carry
  the fix under `Reglas` so the agent does not go debug the code — leave it there:
  `rm -rf apps/<app>/node_modules node_modules/.modules.yaml && pnpm install --frozen-lockfile`.
- **Missing `.env`.** The `afippi` setup hook copies `apps/*/.env` from the root checkout. If setup
  was skipped, the agent must copy them before anything that touches the database.
- **Brief lives outside the worktree.** The scratchpad path is absolute, so the pointer resolves —
  but do not reference paths relative to the parent checkout inside the brief.
- **Orca can list a worktree that no longer exists on disk.** Before reusing a name, check
  `git worktree list` too, and clean the ghost with `orca worktree rm --worktree name:<name> --force`.
