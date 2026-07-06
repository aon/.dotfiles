---
name: code-with-review
description:
  Implement a goal from a spec, then harden it through two review gates and produce a final report. Implements the spec,
  runs the `/code-review` skill and fixes its findings, then runs `/codex:review` and fixes its findings, and finally
  writes a report covering everything done, open questions/doubts, things left unfixed, and what to watch out for. The
  spec may be file paths, pasted context, or inline instructions. Use when the user invokes `/code-with-review`, or asks
  to "implement this then review it twice and report", "build X then code-review and codex-review it", or wants a guided
  implement → review → fix → report loop. Composes with the native `/goal` command for cross-turn autonomy.
---

# code-with-review — implement, review twice, report

Drive a single goal from spec to a reviewed, hardened change with a written report. The flow is fixed:

```
intake → implement → /code-review + fix → /codex:review + fix → final report
```

`$ARGUMENTS` is the spec. It may be: one or more file paths (a written spec, ticket, design doc), pasted context, or
plain instructions. Read whatever it points at before doing anything else.

**Completion condition:** this skill is done only when the final report (Phase 4) has been produced. Both review gates
must have run (or be explicitly recorded as un-runnable). Don't stop early.

## Running autonomously under `/goal`

This skill is self-contained — it cannot call the native `/goal` command (that command is user-trigger-only and not
invocable from a skill). To run it autonomously across turns, the **user** launches it under `/goal`, e.g.:

```
/goal use /code-with-review with <spec> until the final report is produced
```

`/goal` then keeps Claude working turn after turn until the completion condition above is met. Run standalone, the skill
still performs the full flow in one pass.

## Critical rules (gates)

1. **Clarify before building.** If `$ARGUMENTS` is empty, ambiguous, or the acceptance criteria are unclear, STOP and
   use `AskUserQuestion` to pin down scope. Never guess the goal. Skip this only when the spec is unambiguous. (When
   running under `/goal`, prefer stating an explicit assumption and proceeding over blocking, then flag it in the
   report.)
2. **Honor the host repo's conventions.** Read the repo's `CLAUDE.md` / `AGENTS.md` (and any domain guides it points to)
   and follow them. This skill is repo-agnostic — discover the project's lint/typecheck/test commands; don't assume.
3. **Minimal diff.** Change only what the goal needs. Do not refactor, rename, or "improve" adjacent code.
4. **Both review gates are mandatory.** Do not skip `/code-review` or `/codex:review`. If a gate cannot run (tool
   missing, no diff), record exactly why in the report instead of silently dropping it.
5. **Report faithfully.** State what was actually run and its real result. If a check failed, was skipped, or a finding
   was deferred, say so plainly — that is the whole point of the report.
6. **Don't commit or push unless the user asked.** If the spec requests a commit and you are on the default branch
   (`main`/`master`), create a feature branch first.

## Phase 0 — Intake

1. Resolve the spec: read any referenced files, restate the goal in 1–2 sentences, and list concrete acceptance
   criteria. If anything is ambiguous, run the clarification gate (rule 1).
2. Read the host repo's `CLAUDE.md`/`AGENTS.md` and discover its dev-loop commands (lint/format, typecheck, test) from
   `package.json` scripts, `Makefile`, or those guides. Note the per-app/per-package filters if it's a monorepo.
3. If you will commit and are on the default branch, branch first: `git checkout -b feat/<short-goal-slug>`.
4. Create a short todo list (TaskCreate) mirroring the phases so progress is visible.

## Phase 1 — Implement

1. Implement the spec to its acceptance criteria, following the repo conventions from Phase 0 and existing patterns in
   similar files. Keep the diff minimal.
2. Run the repo's dev-loop checks (lint/format + typecheck) on the affected files/packages. Do not proceed to review
   until typecheck is clean for the new code. Record any acceptance criterion you could not meet.

## Phase 2 — `/code-review` + fix

1. Invoke the **`code-review`** skill via the `Skill` tool — the built-in working-tree reviewer that `/code-review` maps
   to, **not** the `code-review:code-review` plugin (which reviews a GitHub PR via `gh`). If what runs asks for a PR
   number, you reached the wrong one; it must review the uncommitted working-tree diff. Do **not** pass `--fix`: it
   would auto-apply *every* finding — including out-of-scope, risky, or false-positive ones — which both breaks the
   minimal-diff rule and erases the fix-vs-defer triage (step 2) that is the whole reason this skill reviews by hand.
   You want the raw findings so you can decide deliberately and report honestly on what you left alone.
2. For each finding it returns, decide: **fix now** (in scope, real) or **defer** (out of scope, false positive, or
   risky). Apply the in-scope fixes with a minimal diff.
3. Re-run the targeted dev-loop checks on anything you touched.
4. Record, for the report: every finding, whether you fixed it, and — for deferrals — the one-line reason.

## Phase 3 — `/codex:review` + fix

`/codex:review` is user-trigger-only (`disable-model-invocation: true`), so it cannot be called through the `Skill`
tool. Run its underlying companion script directly and wait for the verbatim result:

```bash
CODEX_SCRIPT=$(ls -t ~/.claude/plugins/cache/openai-codex/codex/*/scripts/codex-companion.mjs 2>/dev/null | head -1)
if [ -z "$CODEX_SCRIPT" ]; then
  echo "codex companion script not found — record this in the report and continue"
else
  node "$CODEX_SCRIPT" review --wait
fi
```

1. Run the command above. `--wait` runs it in the foreground and returns Codex's review verbatim. (If the script is
   missing or Codex errors/auth-fails, note it in the report and continue — do not fail the whole run.)
2. Triage and fix exactly as in Phase 2: fix in-scope findings, defer the rest with a reason, re-run targeted checks.
3. If you applied non-trivial fixes in this phase, you may re-run the codex review **once** to confirm they resolved —
   no further loops (keeps cost bounded). Record the outcome.

## Phase 4 — Verify + final report

1. **Final verification gate** before writing the report, so the report reflects reality: run the repo's full
   lint+typecheck and the relevant tests (from Phase 0). If you scope or skip the test suite, say so in the report.
2. Write the report to the chat **in English**, using the template below. If the user asked for a file, also save it
   next to the work (e.g. `goal-report-<slug>.md`) — ask where if unsure. Producing this report is the skill's
   completion condition.

### Report template

```markdown
# code-with-review report — <goal in one line>

## What was done

- Goal & acceptance criteria, and which were met.
- Files changed (path — one-line what/why).
- Fixes applied from `/code-review` and from `/codex:review` (brief).

## Verification

- Lint + typecheck: pass / fail (paste the failing bit if any)
- Tests run and result; note anything skipped and why.

## Open questions & assumptions

- Decisions made under uncertainty, assumptions baked in, anything you'd confirm with the user.

## Not fixed / deferred

- Review findings you chose not to fix — each with a one-line reason (out of scope / false positive / risky / needs a
  product call). Explicitly list "none" if everything was addressed.

## Watch out for

- Risks, fragile areas, manual follow-ups (migrations, env vars, deploy steps), and any docs that may need updating.
```

## Notes

- This skill orchestrates; the heavy lifting happens inside the two review tools.
- Keep each review→fix a single pass by default. The only allowed extra pass is the one optional codex re-review in
  Phase 3. Avoid review/fix loops.
- The spec may carry directives (e.g. "commit when done", "skip the full test suite", "high-effort review"). Honor them,
  and note in the report anything you deviated on.
