---
name: pr
description: >-
  Open the pull request for the current branch and stay until CI is green. Writes the body in the
  repo's own language following its template, short and free of AI tells, then waits on the checks
  and fixes whatever breaks. Use when the user says "creá el PR", "abrí el PR", "abrime un PR",
  "subilo", "open the PR", or when a delegated agent reaches the end of its task. Automerge is NOT
  the default: it is only enabled when explicitly asked for.
---

# PR

You open the PR, you get it green, and only then are you done.

## 1. Before you start

- Everything committed and pushed (`git status --porcelain` empty, branch tracking an upstream).
- You are not on `main`.
- If the user asked for automerge, note it: it changes step 5.

## 2. Writing the body

Read the repo's `.github/pull_request_template.md` and follow its sections. Don't copy it here: if
the template changes, this skill won't hear about it.

**Write in the language the repo already uses.** Check before writing — `gh pr list --state merged
--limit 10 --json title,body` and `git log -20 --format=%s`. Match what you find, title and body
alike: a Spanish repo gets Spanish, an English one gets English. Fall back to English when there is
no signal or the history is mixed. An explicit request from the user beats whatever the repo does.

**Hard cap: two sentences and 50 words per section.** No exceptions, no sections that "need a bit
more". If it doesn't fit, it's because you are explaining the diff instead of the why.

Both limits are there because the sentence count alone games easily: two 55-word sentences chained
with colons and em dashes keep to the letter and break the rule.

**What earns a slot is a budget, not a filter.** Every sentence has to carry something the reviewer
**cannot** get from the diff — numbers, ids, the exact error, the alternative you discarded and why
— but qualifying doesn't buy a place. You have two slots: pick the two that change the reviewer's
read the most and drop the rest, however true, relevant, and hard-won. What's left over lives in the
PR thread if someone asks, not in the body.

**One paragraph = one line of the file.** Don't wrap at 100 characters: GitHub renders every newline
as a line break and the paragraph comes out laddered. Newlines only between paragraphs and sections.

**If the feature adds or changes UI, a screenshot goes inside *Solution*.** Take it from the dev
server with real data, host it as a release asset (`gh release create pr-<n>-screenshots <file>
--prerelease --notes "Safe to delete."`) and embed it with `![alt](<asset-url>)`. Never commit the
image to the repo. The screenshot counts against neither the sentence nor the word cap.

**Banned** — this is what makes a PR smell like AI:

| No | Why |
|---|---|
| "This PR introduces / adds / implements…" | Template opener. Start with the fact. |
| Listing the files you touched | It's in the diff. |
| Paraphrasing the diff in prose | Same. |
| "Additionally", "Furthermore", "It's worth noting", "Importantly" | Connector filler. |
| Section emojis, decorative bold | Noise. |
| "robustly / elegantly / cleanly" | Self-praise with no data. |
| A closing paragraph summarising what you just said | You already said it. |
| The whole mechanism when the effect is enough | Technical filler: true, relevant, and surplus. The hardest one to spot, because every sentence passes the filter and the set is still too much. |

Write it as if you were telling a colleague who knows the code: direct, first person where it fits,
no ceremony.

**Example of the tone** (a config fix, from a repo that writes its PRs in English):

```markdown
**Problem:**

`@afippi/core` tests failed with `Cannot find package '@afippi/core/utils/...'` on files that are right there in the source. `pnpm check` passed and so did CI.

**Solution:**

The `test` task declared only `^build`, so core never compiled and the tests ran against a stale `dist`. Added `packages/core/turbo.json` with `dependsOn: ["^build", "build"]`.

---

*Testing:*

Deleted `packages/core/dist` and ran `turbo test --filter=@afippi/core`: 24 files red before, all 58 passing now.
```

That's 24, 24 and 15 words. This is the real size of a good body: the 50-word cap is a ceiling with
room to spare, not a target to reach.

**A real counterexample** — the *Problem* of a date picker fix, 68 words in two sentences:

> While you pick a range in the calendar, the screen behind it reloads and the popover blinks off for half a second on every click: `/dashboard/cuits/` and `/dashboard/cuits/$publicId/` declare `from`/`to` in `loaderDeps`, so rewriting the search params produces a new match in `pending` and React hides the suspended subtree with `display: none` — and react-dom's `hideOrUnhideAllChildren` walks into portals too, so it takes Radix's `PopoverContent` down with it…

Every fact is true and none of it comes from the diff, so they pass the filter one by one — and the
set is still surplus. This was enough: "picking a date rewrites the search params and the route
suspends, which kills the popover mid-pick". If what you have is a nice investigation, the body of
the PR is not where it goes.

## 3. Creating the PR

Before creating it, count the words per section. If any goes over 50, cut — don't negotiate with the
cap:

```bash
awk '/^\*\*.*:\*\*|^\*.*:\*/{if(h)printf "%-14s %s words\n",h,n; h=$0; n=0; next} !/^---$/{n+=NF} END{printf "%-14s %s words\n",h,n}' <file>
```

```bash
gh pr create --title "<conventional commit>" --body-file <file>
```

Conventional prefix on the title, in the same language as the body, matching the main commit.

## 4. Waiting on CI

Don't end the turn with the PR unresolved. Set up a **Monitor** (`persistent: true`, description
`checks for PR <n>`) that emits each check as it closes and stops when none are pending:

```bash
prev=""
while true; do
  s=$(gh pr checks <n> --json name,bucket 2>/dev/null || true)
  [ -n "$s" ] || { sleep 30; continue; }
  cur=$(jq -r '.[] | select(.bucket != "pending") | "\(.name): \(.bucket)"' <<<"$s" | sort)
  comm -13 <(echo "$prev") <(echo "$cur")
  prev=$cur
  jq -e 'all(.bucket != "pending")' <<<"$s" >/dev/null && break
  sleep 30
done
```

The `|| true` is not cosmetic: `gh pr checks` exits non-zero while checks are pending or red, so
without it you lose the output you wanted.

Each check arrives as a notification with its bucket (`pass`, `fail`, `skipping`, `cancel`) — start
fixing the first one that goes red without waiting for the rest. Keep working meanwhile; the
notifications will find you.

Never wait on CI in the foreground: CI takes longer than the cap on a shell call and the timeout
eats it.

## 5. If CI fails

1. Read the log of the check that failed (`gh run view <run-id> --log-failed`).
2. Fix it, commit, push, go back to step 4.
3. **Two attempts maximum.** If it's still red on the third: `gh pr ready --undo`, leave the exact
   output of the failing check in a PR comment, and stop. Don't keep trying and don't hide it.

If the user asked for **automerge** and the PR is green:

```bash
gh pr merge <n> --auto --merge
```

Check which merge methods the repo allows before picking the flag (`gh repo view --json
mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed`); several of these repos only permit merge
commits. Without an explicit request, don't enable it at all.

## 6. Closing

A short summary: what you changed, how it was verified, CI status, PR link. If it ended up as a
draft because of a red check, say that first.
