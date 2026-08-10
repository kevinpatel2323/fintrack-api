# fintrack-api

NestJS REST API. Runs on port 3000. Connects to PostgreSQL via `DATABASE_URL` in `.env`.

## Commands

```bash
npm run start:dev     # watch mode
npm run build         # compile to dist/
npm test              # Jest
npm run test:cov      # coverage
npm run migration:run        # apply pending TypeORM migrations
npm run migration:generate   # scaffold migration from entity diff
npm run migration:revert     # undo last migration
```

## Module map

```
src/
  app.module.ts              Root module — registers all entities + modules
  main.ts                    Bootstrap: CORS, ValidationPipe (whitelist+transform), port
  imports/                   Statement upload, preview, revert, transaction range queries
  transactions/              Manual transaction creation, category assignment
  friends/                   Friend CRUD + TransactionFriendTag CRUD + settlement links
  categories/                Category CRUD (name, color, icon)
  dashboard/                 Read-only aggregation endpoints for dashboard widgets
  subscriptions/             Subscription CRUD + calendar expansion via RRULE
  database/
    entities/                TypeORM entity definitions
    migrations/              Sequential migrations (1707000000000-… series)
    data-source.ts           DataSource for CLI migration commands
```

## API endpoints

### Imports (`/imports`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/imports/hdfc` | Upload HDFC .xlsx statement (multipart `statement` field) |
| POST | `/imports/hdfc/preview` | Parse without persisting; returns `previewRows` |
| POST | `/imports/:id/revert` | Delete import + its transactions + their friend tags (transactional) |
| GET | `/imports` | List imports (paginated: `?page=&limit=&accountNumber=`) |
| GET | `/imports/last` | Most recent import |
| GET | `/imports/:id` | Single import by id |
| GET | `/imports/accounts` | All account numbers |
| GET | `/imports/transactions/range` | Transactions in `?start=&end=&accountNumber=` |

### Transactions (`/transactions`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/transactions/manual` | Create manual transaction |
| PATCH | `/transactions/:id/category` | Assign category (`{ categoryId }`) |
| DELETE | `/transactions/:id/category` | Remove category |

### Friends (`/friends`)
| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/friends` | List (supports `?q=` search) / Create |
| GET/PATCH/DELETE | `/friends/:id` | Read / Update / Delete (blocked if has tags) |
| GET | `/friends/:id/summary` | Net balance totals |
| GET | `/friends/:id/transactions` | Tagged transactions (supports `?start=&end=`) |
| GET | `/friends/:id/linkeable-transactions` | Non-settlement tags available to link |
| PATCH | `/friends/:id/ledger-preferences` | Bulk pin/unpin tags for ledger exports (`{ preferences: [{ tagId, included }] }`; `included: null` forgets the pin) |

### Transaction friend tags (`/transactions/:txId/tags`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/transactions/:txId/tags` | List tags on a transaction |
| POST | `/transactions/:txId/tags` | Create tag (direction, amount, optional `linkedTransactionIds` for SETTLEMENT) |
| PATCH | `/transactions/:txId/tags/:tagId` | Update tag |
| DELETE | `/transactions/:txId/tags/:tagId` | Delete tag (cascades settlement links) |

### Categories (`/categories`)
CRUD at `/categories`. `name` must be unique. Deletion is unrestricted (transactions keep `category_id = NULL`).  
`GET /categories/:id/export?start=&end=` streams the category's transactions as a CSV download (`text/csv`, UTF-8 BOM). Both date bounds are optional — omit them to export every transaction in the category.

### Dashboard (`/dashboard`)
All endpoints are read-only. Accept optional `?startDate=&endDate=&accountNumber=`.

| Endpoint | Returns |
|----------|---------|
| `GET /dashboard/summary` | All widgets in one request |
| `GET /dashboard/spending-overview` | totalSpent, totalIncome, netChange, comparison period |
| `GET /dashboard/category-breakdown` | Expenses grouped by category with percentage |
| `GET /dashboard/friend-balances` | Net balance per friend (non-zero only) |
| `GET /dashboard/monthly-trends` | Per-month spend/income for last N months (`?monthsBack=6`) |
| `GET /dashboard/account-summary` | Per-account balance, deposit/withdrawal totals |
| `GET /dashboard/top-categories` | Top N expense categories (`?limit=5`) |
| `GET /dashboard/income-vs-expenses` | Savings rate, expense % of income |

### Subscriptions (`/subscriptions`)
CRUD at `/subscriptions`. Calendar endpoint: `GET /subscriptions/calendar?start=YYYY-MM-DD&end=YYYY-MM-DD`.  
Returns all active subscription occurrences in range, expanded from RRULE, excluding `exdates`.  
Hard limits: 10,000 occurrences per subscription, 50,000 total per request.

## Statement parsing (`src/imports/parsers/hdfc.parser.ts`)

Reads HDFC Excel (.xlsx) export:
- Account number extracted from row 14, column E (characters 12–26)
- Transaction body: rows 21 to `len - 18`
- Date format: `DD/MM/YY`
- UPI metadata (name, description, bank) parsed from narration string

## Entity rules

- All monetary columns are `NUMERIC(14,2)`. TypeORM transformer converts to `number` on read.
- All PKs are `BIGINT` stored as `string` in TypeScript.
- `synchronize: false` — always use migrations.
- `transaction_friend_tags` has a unique constraint on `(transaction_id, friend_id)`.
- `settlement_links` has a unique constraint on `(settlement_tag_id, settled_tag_id)`.
- `SETTLEMENT` direction tags may carry `linkedTransactionIds`; only non-settlement tags can be linked.
- `transaction_friend_tags.ledger_included` is a *nullable* boolean: `NULL` = no saved export choice, `TRUE`/`FALSE` = pinned in/out of the friend's PDF ledger. Nullable is load-bearing — "never decided" must stay distinct from "decided to include".

## Subscription RRULE rules

- `rrule` column stores the RRULE body **without** the `RRULE:` prefix (e.g. `FREQ=MONTHLY;BYMONTHDAY=15`).
- `dtstart` is a `DATE` column (YYYY-MM-DD); expanded internally to UTC noon to avoid DST shifts.
- `exdates` is a `jsonb` array of ISO date strings excluded from the recurrence.
- Validate with `validateRrule(rrule, dtstart)` from `subscription-rrule.util.ts` before saving.

## Testing

Jest. Two spec styles:
- `*.spec.ts` — standard unit tests
- `*.pbt.spec.ts` — property-based tests via `fast-check`

Run `npm test` or `npm run test:cov` for coverage.
