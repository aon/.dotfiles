# ActualQL (AQL) reference

AQL is the query language behind `actual query run`. It's MongoDB-ish: JSON filter objects, dotted field paths for joins, and aggregate expressions written as `{outputName: {$op: "$field"}}`.

## Tables

- `transactions` — every transaction
- `accounts` — bank/cash accounts
- `categories` — budget categories
- `payees`
- `rules`
- `schedules`

Get schema at runtime:

```bash
actual query tables
actual query fields <table>
```

## Filters

Filter is a JSON object. Top-level keys are field names; values are either literals (equality) or `{operator: value}` objects.

Operators:

| Op | Meaning |
|----|---------|
| `$eq` | equals (the default if you just pass a literal) |
| `$ne` | not equals |
| `$lt`, `$lte`, `$gt`, `$gte` | numeric/date compare |
| `$like` | SQL LIKE; use `%` as wildcard |
| `$and` | array of sub-conditions, all must match |
| `$or` | array of sub-conditions, any must match |

`null` is a literal — use it for missing values:

```json
{"category": null}    // uncategorized transactions
```

Examples:

```json
// April 2026 expenses — note the $and around the two date constraints
{"$and":[{"date":{"$gte":"2026-04-01"}},{"date":{"$lte":"2026-04-30"}},{"amount":{"$lt":0}}]}

// Whole Foods OR Trader Joe's
{"$or":[{"payee.name":"Whole Foods"},{"payee.name":"Trader Joe's"}]}

// Notes contain "refund"
{"notes":{"$like":"%refund%"}}

// Genuinely uncategorized — NOT a transfer
{"$and":[{"category":null},{"payee.transfer_acct":null},{"is_parent":false}]}
```

### The same-key gotcha

`{"date":{"$gte":"2026-04-01"},"date":{"$lte":"2026-04-30"}}` does NOT mean "April 2026". JSON keys must be unique, so one of the two gets silently dropped — usually the first. Always wrap multi-bound constraints in `$and`:

```json
{"$and":[{"date":{"$gte":"2026-04-01"}},{"date":{"$lte":"2026-04-30"}}]}
```

### Detecting transfers

A transaction is a transfer between the user's own accounts when its payee has `transfer_acct` set (the ID of the *other* account). Three ways to filter:

- `payee.transfer_acct: null` — exclude transfers from the result
- `payee.transfer_acct: {$ne: null}` — only transfers
- `transfer_id` field on the transaction also indicates a transfer link; either works.

Transfers correctly have no category; never report them as "needs categorisation".

## Select

`--select` is a comma-separated list of plain fields, or for aggregates use `--file` and pass a JSON object whose `select` is an array mixing strings and `{name: {$op: "$field"}}` objects.

Aggregate ops: `$sum`, `$count`, `$min`, `$max`, `$avg`.

```json
{
  "table": "transactions",
  "filter": {"date":{"$gte":"2026-05-01","$lte":"2026-05-31"},"is_parent":false,"amount":{"$lt":0}},
  "groupBy": ["category.name"],
  "select": ["category.name", {"total": {"$sum": "$amount"}}, {"n": {"$count": "$id"}}]
}
```

## Joined fields

Joins are dotted paths. You don't write JOIN; you just reference `payee.name`, `category.name`, `account.name`, `category.group.name`. They work in `select`, `filter`, `groupBy`, and `orderBy`.

## Pagination & ordering

```bash
--order-by "date:desc,amount:desc"
--limit 50 --offset 100
```

`--last N` is shorthand for `--table transactions --order-by date:desc --limit N`.

## Counting

`--count` returns just the matching row count, no data. Cheaper than pulling rows just to count them.

## Pitfalls

1. **Split transactions.** A split parent row has the full amount AND child rows have the parts. To sum money without double-counting, filter `"is_parent": false`. To get only the parent (e.g. show the user the split as one entry), filter `"is_child": false`.

2. **No date subfields.** `date.month`, `date.year`, `date.day` are NOT queryable. To compute monthly totals, fetch transactions with a date-range filter and bucket in your own code (JSON output + jq/python), or run one query per month.

3. **Cents, not dollars.** Every amount is integer cents. `--filter '{"amount":{"$lt":-10000}}'` means "more than $100 spent." Table/CSV output displays decimals; JSON gives raw integers.

4. **Off-budget accounts.** Off-budget accounts (e.g. investment, loan) are included by default in transaction queries. Filter `account.offbudget: false` or restrict to specific account IDs if the user only cares about budgeted activity.

5. **Uncategorized vs zero.** `category: null` means "not assigned"; it's not the same as a category whose name is "Uncategorized". Both can exist.

6. **Rate limit / auth.** Loops of small queries can fail. Prefer one wide query, then aggregate locally.

## Recipes

All recipes assume `--sync-id <groupId>` is passed (or `ACTUAL_SYNC_ID` is set in the shell).

### Spend per category, this month

```bash
echo '{
  "table":"transactions",
  "filter":{"$and":[{"date":{"$gte":"2026-05-01"}},{"date":{"$lte":"2026-05-31"}},{"is_parent":false},{"amount":{"$lt":0}}]},
  "groupBy":["category.name"],
  "select":["category.name",{"total":{"$sum":"$amount"}}],
  "orderBy":[{"total":"asc"}]
}' | actual --sync-id <groupId> query run --file -
```

(Order ascending: most-negative first = biggest spends first.)

### Income for the year

```bash
echo '{
  "table":"transactions",
  "filter":{"$and":[{"date":{"$gte":"2026-01-01"}},{"date":{"$lte":"2026-12-31"}},{"is_parent":false},{"amount":{"$gt":0}},{"payee.transfer_acct":null}]},
  "select":[{"total":{"$sum":"$amount"}}]
}' | actual --sync-id <groupId> query run --file -
```

(Excluding transfers — a transfer in is not income.)

### How much did I spend at <payee> in the last 90 days

```bash
echo '{
  "table":"transactions",
  "filter":{"$and":[{"date":{"$gte":"2026-02-27"}},{"payee.name":"🥦 Supermercado"},{"is_parent":false}]},
  "select":[{"total":{"$sum":"$amount"}},{"n":{"$count":"$id"}}]
}' | actual --sync-id <groupId> query run --file -
```

### Genuinely uncategorized transactions to clean up

Note `payee.transfer_acct: null` — without it, you'll incorrectly show transfers as "uncategorized".

```bash
actual --sync-id <groupId> query run --table transactions \
  --filter '{"$and":[{"category":null},{"payee.transfer_acct":null},{"is_parent":false},{"date":{"$gte":"2026-05-01"}},{"date":{"$lte":"2026-05-31"}}]}' \
  --select "date,amount,payee.name,notes" \
  --order-by "date:desc" --limit 50 --format table
```

### Find all transactions from a payee for renaming/merging

```bash
actual --sync-id <groupId> query run --table transactions \
  --filter '{"payee.name":{"$like":"%Supermercado%"}}' \
  --select "id,date,amount,payee.name" --format json
```
