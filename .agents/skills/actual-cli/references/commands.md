# Full command reference

This is a flat list of every `actual` subcommand with its options. Use it when you need a flag you don't remember. For working patterns and gotchas, prefer SKILL.md and `aql.md`; this file is just a lookup.

When in doubt, run `actual <cmd> <sub> --help` — it's authoritative.

## Global options

| Flag | Notes |
|------|-------|
| `--server-url <url>` | Already injected by the `actual` shell function. Don't pass. |
| `--password <pw>` | Same — already injected. |
| `--session-token <token>` | Alternative auth. |
| `--sync-id <id>` | Budget identifier. Already configured. |
| `--data-dir <path>` | Local cache dir. |
| `--encryption-password <pw>` | E2E budgets only. |
| `--format <json\|table\|csv>` | Output format. Default `json`. |
| `--verbose` | Stderr informational messages. |

## accounts

- `list [--include-closed]`
- `create --name <name> [--offbudget] [--balance <cents>]`
- `update <id> [--name <name>] [--offbudget <true\|false>]`
- `close <id> [--transfer-account <id>] [--transfer-category <id>]`
- `reopen <id>`
- `delete <id>`
- `balance <id> [--cutoff <YYYY-MM-DD>]`

## budgets

- `list` — budgets on the server
- `download <syncId> [--encryption-password <pw>]`
- `sync` — sync the current budget
- `months` — list available budget months
- `month <YYYY-MM>` — full budget data for a month
- `set-amount --month <YYYY-MM> --category <id> --amount <cents>`
- `set-carryover --month <YYYY-MM> --category <id> --flag <true\|false>`
- `hold-next-month --month <YYYY-MM> --amount <cents>`
- `reset-hold --month <YYYY-MM>`

## categories

- `list`
- `create --name <name> --group-id <id> [--is-income]`
- `update <id> [--name <name>] [--hidden <true\|false>] [--group-id <id>]`
- `delete <id> [--transfer-to <id>]`

## category-groups

- `list`
- `create --name <name> [--is-income]`
- `update <id> [--name <name>] [--hidden <true\|false>]`
- `delete <id> [--transfer-to <id>]`

## transactions

- `list --account <id> [--start <YYYY-MM-DD>] [--end <YYYY-MM-DD>]`
- `add --account <id> (--data <json> | --file <path>) [--learn-categories] [--run-transfers]`
- `import --account <id> (--data <json> | --file <path>) [--dry-run]` — deduplicates against `imported_id`
- `update <id> --data <json>`
- `delete <id>`

Transaction JSON fields when adding:
- `date` (YYYY-MM-DD, required)
- `amount` (integer cents, required; negative = expense)
- `payee` (id) **or** `payee_name` (string; matched/created)
- `category` (id)
- `notes`
- `cleared` (bool)
- `imported_id` (string; key for dedup on import)
- `subtransactions` (array, for splits)

## payees

- `list`
- `common` — frequently used
- `create --name <name>`
- `update <id> --name <name>`
- `delete <id>`
- `merge --target <id> --ids <id1>,<id2>,...`

## tags

- `list`
- `create --tag <name> [--color <#hex>] [--description <text>]`
- `update <id> [--tag <name>] [--color <#hex>] [--description <text>]`
- `delete <id>`

## rules

- `list`
- `payee-rules <payeeId>`
- `create (--data <json> | --file <path>)`
- `update --data <json>`
- `delete <id>`

## schedules

- `list`
- `create --data <json>`
- `update <id> --data <json> [--reset-next-date]`
- `delete <id>`

## query

- `tables`
- `fields <table>`
- `run [--table <t>] [--select <fields>] [--filter <json>] [--where <json>] [--order-by <fields>] [--limit <n>] [--offset <n>] [--last <n>] [--count] [--group-by <fields>] [--file <path>]`

`--file -` reads the full query object from stdin. This is the right move whenever you need aggregate select expressions.

## server

- `version`
- `get-id --type <accounts|categories|payees|category_groups> --name <name>` — name → id
- `bank-sync [--account <id>]` — trigger bank sync
