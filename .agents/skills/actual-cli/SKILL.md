---
name: actual-cli
description: Query and manage Actual Budget data through the `actual` CLI. Use whenever the user asks about their budget, spending, transactions, accounts, categories, payees, monthly budget amounts, carryover, or any personal finance question involving Actual Budget. Triggers include phrases like "how much did I spend on X", "what's my balance", "list my transactions", "add a transaction", "set budget for category Y", "how much is left in groceries", "import these transactions", "show me my categories", "sync my budget", or any natural-language personal-finance question the user could reasonably expect Actual to answer. Prefer this skill over guessing — Actual stores authoritative data and the CLI is the way to read or change it.
---

# actual-cli

The `actual` command talks to the user's Actual Budget server. The shell function `actual` already injects `ACTUAL_SERVER_URL` and `ACTUAL_PASSWORD` — invoke it directly, do not try to set env vars or pass `--server-url`/`--password`.

```bash
actual <command> <subcommand> [options]
```

Top-level commands: `accounts`, `budgets`, `categories`, `category-groups`, `transactions`, `payees`, `tags`, `rules`, `schedules`, `query`, `server`.

## Step 0: pick the budget — do this *first*, every time

The user has more than one budget on the server (currently **ARS** and **USD**, in different currencies). AQL only sees one budget at a time, and most amounts aren't comparable across currencies. **At the start of every Actual-related conversation, ask the user which budget they want to work with**, then pin that budget for the rest of the session.

```bash
actual budgets list --format json
```

The output gives you each budget's name and a `groupId`. **Pass that `groupId` as `--sync-id`** on every subsequent command — not `id`, not `cloudFileId`, not the local `My-Finances-…` directory name. The user's two budgets:

- **ARS** → `--sync-id 22046340-2486-4c96-aa34-3158798f1480`
- **USD** → `--sync-id 44d2884e-cd2e-4a93-adbb-e9fe96a2e72e`

Verify before guessing — re-run `budgets list` if the IDs look stale. Set `ACTUAL_SYNC_ID=<groupId>` in the same shell once you've picked, so you don't have to repeat `--sync-id` on every call.

Why "ask first" matters: the user has explicitly said they want to focus on one budget per task. Reporting "top 5 categories across both budgets" is *not* what they want — it forces them to read two reports when they wanted one. If the user's question is genuinely about both (e.g. "list all my accounts everywhere"), do both, but *say so out loud* and only after confirming.

## Output formats

`--format` controls output: `json` (default, machine-readable, integer cents), `table` (human-friendly, decimals), `csv`. Use `table` when reporting to the user, `json` when you need to parse.

## The single most important data rule: amounts are integer cents

`-12350` means `-$123.50`. Negative = expense, positive = income/inflow. When the user says "I spent $42.99", that's `-4299`. When showing JSON-parsed results to the user, divide by 100. `table` and `csv` outputs format decimals for you; `json` does not.

## Discover before guessing

You don't know the user's IDs or what they named things. Before doing anything that needs an account, category, payee, or group ID, look it up. **The user's categories aren't necessarily in English** — "Groceries" might be `🥦 Supermercado`, "Rent" might be `🏡 Alquiler`, etc. Don't assume; list and match semantically.

```bash
actual --sync-id <groupId> accounts list --format json
actual --sync-id <groupId> categories list --format json    # has name, group_id, is_income, hidden
actual --sync-id <groupId> category-groups list --format json
actual --sync-id <groupId> payees list --format json
actual --sync-id <groupId> server get-id --type categories --name "🥦 Supermercado"
```

Watch out for **hidden / legacy categories with similar names** (e.g. a renamed category and its predecessor both surviving as separate IDs). If you find two categories that look like they should be one, show them both to the user and ask which one they mean.

## Querying with AQL

`query` exposes the internal tables (`transactions`, `accounts`, `categories`, `payees`, `rules`, `schedules`) for selecting, filtering, ordering, grouping, and aggregating.

Cheatsheet:

```bash
# Last 10 transactions, human-readable
actual --sync-id <groupId> query run --last 10 --format table

# Transactions in a date range, with payee/category/account names joined in
actual --sync-id <groupId> query run --table transactions \
  --select "date,amount,payee.name,category.name,account.name,notes" \
  --filter '{"$and":[{"date":{"$gte":"2026-04-01"}},{"date":{"$lte":"2026-04-30"}}]}' \
  --order-by "date:desc" --format json

# Total spend in a category for a month (aggregate via --file because select needs an expression)
echo '{
  "table":"transactions",
  "filter":{"$and":[{"date":{"$gte":"2026-04-01"}},{"date":{"$lte":"2026-04-30"}},{"category":"<categoryId>"},{"is_parent":false}]},
  "select":[{"total":{"$sum":"$amount"}}]
}' | actual --sync-id <groupId> query run --file -

# Spend by category for a month
echo '{
  "table":"transactions",
  "filter":{"$and":[{"date":{"$gte":"2026-05-01"}},{"date":{"$lte":"2026-05-31"}},{"is_parent":false},{"amount":{"$lt":0}}]},
  "groupBy":["category.name"],
  "select":["category.name",{"total":{"$sum":"$amount"}}]
}' | actual --sync-id <groupId> query run --file -

# Count, not data
actual --sync-id <groupId> query run --table transactions --filter '{"category":null}' --count
```

Filter operators: `$eq`, `$ne`, `$lt`, `$lte`, `$gt`, `$gte`, `$like`, `$and`, `$or`. Use `null` for missing values (e.g. uncategorized).

Joined name fields on transactions: `account.name`, `payee.name`, `category.name`, `category.group.name`, `payee.transfer_acct` (id of the other account if this is a transfer; null otherwise).

For full AQL details and recipes, see `references/aql.md`.

## Five pitfalls that will burn you

1. **Two keys with the same name in a single filter object collapse to one.** This is the AQL gotcha that bites everyone:
   ```json
   // BROKEN — the $gte gets silently dropped
   {"date":{"$gte":"2026-04-01"},"date":{"$lte":"2026-04-30"}}
   // CORRECT — wrap both in $and
   {"$and":[{"date":{"$gte":"2026-04-01"}},{"date":{"$lte":"2026-04-30"}}]}
   ```
   Whenever you constrain the same field twice (date ranges, amount ranges), use `$and`.

2. **Transfers are *not* uncategorized.** A transfer between the user's own accounts has `category: null` by design — that's correct, not a cleanup task. When the user asks for "uncategorized transactions to clean up", you must additionally filter out transfers:
   ```json
   {"$and":[{"category":null},{"payee.transfer_acct":null},{"is_parent":false},
            {"date":{"$gte":"2026-05-01"}},{"date":{"$lte":"2026-05-31"}}]}
   ```
   `payee.transfer_acct` is the account ID the payee represents if it's a "transfer to/from <Account>" payee. Non-null → transfer. Don't show these to the user as "needs cleanup" — they're handled.

3. **Split transactions double-count.** A split parent has the total *and* its child rows have the parts. When summing or counting, add `"is_parent": false`. To list splits as single entries instead of leaf rows, use `"is_child": false`.

4. **AQL has no `date.month` or `date.year`.** Don't try to group by month in the query. Fetch with a date range filter and aggregate locally, or run one query per month range.

5. **Rapid sequential calls can trip auth.** Prefer one wide query over a loop of narrow ones.

## Mutations

Mutations require IDs. Resolve names → IDs first, then act. Confirm with the user before destructive actions (`delete`, `merge`, `close`).

### Transactions

```bash
# Add. account is the id, amount is integer cents, date is YYYY-MM-DD.
actual --sync-id <groupId> transactions add --account <accountId> --data '[{
  "date":"2026-05-28","amount":-4299,"payee_name":"Whole Foods","category":"<categoryId>","notes":"weekly groceries"
}]'

# Bulk add from a JSON file
actual --sync-id <groupId> transactions add --account <accountId> --file ./tx.json

# Import (dedupes against imported_id). Use --dry-run first when unsure.
actual --sync-id <groupId> transactions import --account <accountId> --file ./bank-export.json --dry-run

# Update / delete
actual --sync-id <groupId> transactions update <txId> --data '{"category":"<categoryId>"}'
actual --sync-id <groupId> transactions delete <txId>
```

Useful add fields: `date`, `amount` (cents), `payee` (id) **or** `payee_name` (string; will match/create), `category`, `notes`, `cleared`, `imported_id`.

### Budget amounts

Per month, per category, in integer cents.

```bash
actual --sync-id <groupId> budgets month 2026-05
actual --sync-id <groupId> budgets set-amount --month 2026-05 --category <categoryId> --amount 50000   # $500
actual --sync-id <groupId> budgets set-carryover --month 2026-05 --category <categoryId> --flag true
actual --sync-id <groupId> budgets hold-next-month --month 2026-05 --amount 20000
actual --sync-id <groupId> budgets reset-hold --month 2026-05
actual --sync-id <groupId> budgets sync
```

### Accounts, categories, payees, groups

```bash
actual --sync-id <groupId> accounts create --name "Savings" --balance 100000
actual --sync-id <groupId> accounts close <id> [--transfer-account <id>] [--transfer-category <id>]
actual --sync-id <groupId> accounts balance <id> [--cutoff 2026-05-01]

actual --sync-id <groupId> category-groups create --name "Fixed Costs"
actual --sync-id <groupId> categories create --name "Rent" --group-id <groupId>
actual --sync-id <groupId> categories delete <id> --transfer-to <otherCategoryId>

actual --sync-id <groupId> payees create --name "Local Bakery"
actual --sync-id <groupId> payees merge --target <keepId> --ids <dropId1>,<dropId2>
```

For full subcommand options, see `references/commands.md`.

## Workflow for "answer a question about my budget"

1. **Ask which budget** (ARS or USD) if not already pinned this session.
2. Decide what tables/filters you need. Date range? Category? Account?
3. Resolve names → IDs if needed (especially category names — they may not be in English).
4. Run **one** AQL query that returns everything in scope. Use `$and` for any field constrained twice. Use `--format json` for parsing or `--format table` for direct display.
5. Aggregate/format — divide cents by 100 — and report a clean number with the date range, currency, and caveats (split parents excluded, transfers excluded, etc.).
6. If a number looks off, `actual --sync-id <groupId> budgets sync` and re-query — the local cache can be stale.

## Workflow for "make a change"

1. Confirm which budget.
2. Echo what you're about to change in *names*, not IDs ("Add -$42.99 to Checking, category Groceries, payee Whole Foods, dated 2026-05-28").
3. Resolve IDs, do the smallest mutation, read it back to verify.
4. Show the user a one-line summary of what happened.

## When the CLI itself fails

The `actual` shell function runs `pnpm dlx @actual-app/cli`, which downloads a fresh tarball with a precompiled `better-sqlite3` native binding. If the local Node version's ABI doesn't match the prebuilt binary, every call dies with `NODE_MODULE_VERSION` errors. If you hit this:

1. Try the globally installed CLI under nvm:
   ```bash
   . "$NVM_DIR/nvm.sh" && nvm use v22.18.0
   /Users/agustin/.nvm/versions/node/v22.18.0/lib/node_modules/@actual-app/cli/dist/cli.js --sync-id ... ...
   ```
2. Or rebuild the binding in the pnpm dlx cache:
   ```bash
   cd ~/Library/Caches/pnpm/dlx/*/node_modules/better-sqlite3 && npm run install
   ```
3. Or as a *read-only last resort*, the local SQLite copies live at `~/.actual-cli/data/My-Finances-<hash>/db.sqlite` — column names use camelCase (`isParent`, `transferred_id`) and dates are encoded as `YYYYMMDD` integers. Only fall back to this if (1) and (2) are unworkable, and tell the user you're doing it.

## When you're stuck

- `actual <cmd> --help` and `actual <cmd> <subcmd> --help` are authoritative — source of truth, more current than this skill.
- `actual --sync-id <groupId> query tables` and `actual --sync-id <groupId> query fields <table>` for schema.
- Web docs: https://actualbudget.org/docs/api/cli/ and AQL: https://actualbudget.org/docs/api/actual-ql/
