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
  accounts/                  Bank accounts and the holder name each is shown by
  friends/                   Friend CRUD + TransactionFriendTag CRUD + settlement links
  categories/                Category CRUD (name, color, icon)
  dashboard/                 Read-only aggregation endpoints for dashboard widgets
  subscriptions/             Subscription CRUD + calendar expansion via RRULE
  transaction-memos/         Bank SMS + typed memos from the iPhone shortcut; paired devices
  database/
    entities/                TypeORM entity definitions
    migrations/              Sequential migrations (1707000000000-… series)
    data-source.ts           DataSource for CLI migration commands
```

## API endpoints

### Imports (`/imports`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/imports/hdfc` | Upload HDFC .xlsx statement (multipart `statement` field). A credit-card statement is routed to the card it names; optional `confirmedMatches` form field (JSON `[{parsedIndex, existingId}]`) narrows which rows merge into unbilled entries instead of being inserted |
| POST | `/imports/hdfc/preview` | Parse without persisting; returns `previewRows` |
| POST | `/imports/:id/revert` | Delete import + its transactions + their friend tags (transactional) |
| GET | `/imports` | List imports (paginated: `?page=&limit=&accountNumber=`) |
| GET | `/imports/last` | Most recent import |
| GET | `/imports/:id` | Single import by id |
| GET | `/imports/accounts` | All account numbers (the web uses `/accounts`, which carries the holder names) |
| GET | `/imports/transactions/range` | Transactions in `?start=&end=&accountNumber=` |

### Accounts (`/accounts`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/accounts` | Every account: `{ id, accountNumber, holderName, transactionCount, lastTransactionDate }`, by number |
| PATCH | `/accounts/:id` | Name the account after its holder (`{ holderName: string\|null }`, 100 max); blank or `null` clears it |

`accounts.holder_name` is what the app shows in place of the account number everywhere (the
web, and the category CSV's Account column); NULL until named, never blank
(`chk_accounts_holder_name_not_blank`). The number stays the account's identity: statements
match an account by it, and filters (`?accountNumber=`) still take it.

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
| GET | `/friends/review-summary` | Friends with legacy (amount-less) settlements and how many need a decision |
| GET | `/friends/:id/summary` | Net balance and the reconciled bill-wise view: `openOwesMe`, `openIOwe`, `onAccountReceived`/`Paid`, `legacyDifference`, `legacyNeedingReview` |
| GET | `/friends/:id/transactions` | Tagged transactions (supports `?start=&end=`) |
| GET | `/friends/:id/linkable-transactions` | Non-settlement tags available to link |
| GET | `/friends/:id/open-dues` | What a settlement can be applied to: `data` (entries pending on either side, oldest first), `refundable` (other settlements' money on account), `groups` (`{ id, title, entryIds }` for entry groups with open entries), `balance`. `?settlementTagId=` when editing one: its own links are left out and returned as `currentAllocation` |
| GET/POST | `/friends/:id/groups` | Entry groups with their derived figures and entries / create one (`{ title, tagIds }`, at least 2) |
| PATCH/DELETE | `/friends/:id/groups/:groupId` | Rename / add / remove entries (`{ title?, addTagIds?, removeTagIds? }`; emptied → deleted, returns `{ id, deleted: true }`) / ungroup (entries stay) |
| GET/POST | `/friends/:id/offsets` | List / create a netting without money (`{ lines: [{ tagId, amount }], note? }`, both sides equal) |
| DELETE | `/friends/:id/offsets/:offsetId` | Undo a netting |
| POST | `/friends/:id/write-offs` | Write off a leftover on an entry or settlement (`{ tagId, amount, reason? }`) |
| DELETE | `/friends/:id/write-offs/:writeOffId` | Undo a write-off |
| GET/POST | `/friends/:id/legacy-review` | Suggested amounts for amount-less settlements / apply them (all of the friend's at once) |
| PATCH | `/friends/:id/ledger-preferences` | Bulk pin/unpin tags for ledger exports (`{ preferences: [{ tagId, included }] }`; `included: null` forgets the pin) |

### Transaction friend tags (`/transactions/:txId/tags`)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/transactions/:txId/tags` | List tags on a transaction |
| POST | `/transactions/:txId/tags` | Create tag (direction, amount; for SETTLEMENT optional `allocations: [{ tagId, amount }]`, or legacy `linkedTransactionIds` — not both; otherwise optional `entryGroupId`) |
| PATCH | `/transactions/:txId/tags/:tagId` | Update tag. `allocations` replaces a settlement's allocations (`[]` = all on account); omit it to leave them alone. `entryGroupId` moves it into a group, `null` takes it out |
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

### Transaction memos — web (`/transaction-memos`, passkey session)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/transaction-memos` | List (`?tab=all\|no-memo\|debit\|credit&q=&page=&pageSize=`), newest first |
| GET | `/transaction-memos/summary` | `{ withoutMemo, total, lastReceivedAt }` (nav badge) |
| GET/PATCH/DELETE | `/transaction-memos/:id` | Detail with the unsealed SMS and location / set the memo (`{ memo: string\|null }`) / delete |
| POST | `/transaction-memos/:id/reparse`, `/transaction-memos/reparse-all` | Re-read one / every row from an older parser or unreadable |
| POST | `/transaction-memos/devices/pair-code` | Open a 10-minute pairing window: `{ code, setupText: 'fintrack:pair:…', expiresAt }` |
| GET/DELETE | `/transaction-memos/devices[/:id]` | Paired devices (`pairing\|active\|revoked`, last contact, waiting count) / revoke |

### Transaction memos — phone (`/api/v1`, device key)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/devices/pair` | `{ code, name? }` → `{ status: 'paired', key }`. 404 unless a window is open |
| GET | `/api/v1/devices/me` | `{ status: 'ok' }` for a live key |
| POST | `/api/v1/memos` | Upsert by `submissionId`: an SMS (+ memo), or a memo alone for an SMS already sent |
| GET | `/api/v1/memos/pending` | This device's last-24 h rows with no memo, as one-line summaries |
| GET | `/api/v1/accounts` | `{ status: 'ok', names: { last4: holderName } }` for named bank accounts; the Shortcut saves it for offline memo prompts. 404 unless `MEMO_DEVICE_ACCOUNT_NAMES=true` |

## Transaction memos (`src/transaction-memos/`)

The Fintrack Memos iPhone shortcut sends each bank, UPI or card SMS with the memo typed
when it arrived. **Memos are reference notes only — they never create or change a
transaction.** The brand is Fintrack only; never name the third-party shortcut it grew from.

- **Never lose an SMS.** Every `transaction_memos` column but `id`/`created_at` is nullable;
  `sms-parser.ts` never refuses (only reports `parsed`/`partial`/`unreadable`), a parser
  exception still stores the row, and any server failure on a device route answers
  `{ status: 'retry' }` (503) so the phone keeps its outbox file. Bump
  `SMS_PARSER_VERSION` with parser changes; `reparse-all` re-reads older rows.
- **Idempotent.** `submission_id` and `content_hash` (sender + text + arrival time) are
  unique; a repeat returns the existing row and only fills in a missing memo or location.
- **Device replies** (`device-reply.filter.ts`): `accepted`, `refused` (OTP, nothing
  stored), `invalid` (phone moves the file to `failed/`), `retry`, `slow_down`. Any
  failure without a valid device key is the stock Nest 404, so the routes look absent.
- **Security.** `DeviceKeyGuard` ignores `AUTH_DISABLED`. Device keys (`fintrack_` + 43)
  and pairing codes are stored only as SHA-256; pairing is single-use, 10 minutes, 5
  tries. A key can only write its own rows and edit their memo for 7 days. The SMS
  text (card numbers masked first) and location (4 dp) are sealed with AES-256-GCM under
  `MEMO_DATA_KEY`; with no key, ingest fails closed. Never log device request bodies.
- `card_id` is set only for an exact, unambiguous `cards.last4` match. Alert last4 can
  differ from the statement's (HDFC alerts say 0531 for card 2209); no alias map yet.
- An account SMS is shown by its account's holder name when its last4 finds exactly one
  account and it is named (`holderNamesByLast4` in `memo-summary.ts`, the web's rule):
  device replies then carry `accountName` (left out otherwise) and summaries end with
  the name. The Shortcut builds its memo prompt from the SMS ("HDFC ••6714"), then shows
  the reply's `accountName`, or offline the name it saved from `GET /api/v1/accounts`
  (`Fintrack/account-names.txt`, refreshed on charger/Wi-Fi/scheduled runs). Only a bank
  account mention takes a name, never a card. The offline copy needs
  `MEMO_DEVICE_ACCOUNT_NAMES=true`: without it a device key stays write-only (beyond its own
  rows, it reads nothing), and offline prompts keep "HDFC ••6714".
- `scripts/transaction-memos-e2e.mjs` exercises every route against a local database.

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

## Friend ledger: bill-wise settlement (`src/friends/friend-ledger.ts`)

Every rule about what is pending, applied, netted, written off and owed lives in the pure
`computeLedger(rows)` (tested in `friend-ledger.spec.ts`). `friend-ledger.store.ts` loads a
friend's rows; `FriendsService` applies a proposed change in memory and saves only if
`newErrors(before, after)` is empty and no *other* settlement flips direction
(`assertLedgerChange`). Add new settlement rules there, not in the service.

- **Entry** = OWES_ME / I_OWE tag. **Settlement** = SETTLEMENT tag (money moved).
- **Link** (`settlement_links`, `amount`): a settlement applying `amount` to an entry —
  Tally's "Agst Ref". Entries of *both* sides may be linked: the other side is netted in
  (₹10,000 received + ₹14,400 the user owes clears ₹24,400 of what the friend owes). A link
  to another SETTLEMENT is a **refund** of that settlement's money on account.
- **Side** (`transaction_friend_tags.settlement_side`): `received` / `paid`, derived — the
  larger side of linked entries, or the opposite of the refunded settlement — and stored by
  `syncSettlementSides` after every write so SQL balance queries read one column
  (`settlementPaidAmountSql`). Refunds of refunds are rejected (`refund_chain`).
- **Offset** (`friend_offsets` + lines): nets entries of the two sides with no money; both
  sides must be equal. Never changes the balance. Deleting an entry voids its whole offset.
- **Write-off** (`tag_write_offs`): closes a leftover on an entry or a settlement with a
  reason (round-off). Moves the balance by exactly its amount (`writeOffAdjustmentSql`).
- **Legacy links** (`amount IS NULL`, made before amounts existed): **never backfill or
  guess them.** Entry reads as settled, settlement as fully applied and `received`.
  `suggestLegacyConversion` proposes amounts (oldest settlement first); the user accepts
  them per friend via `GET/POST /friends/:id/legacy-review`, which converts all of that
  friend's legacy settlements at once.
- Reconciliation always holds: `net = openOwesMe − openIOwe − onAccountReceived +
  onAccountPaid + legacyDifference`; `legacyDifference` is zero once legacy is reviewed.
- Tag responses carry `pendingAmount`, `settledAmount`, `nettedAmount`, `writtenOffAmount`,
  `settlementStatus`, `allocatedAmount`, `refundedAmount`, `unallocatedAmount`,
  `settlementSide`, `settlementLegacy`, `balanceDelta` (the web ledger's running balance
  uses it), `writeOffs`, `offsets`, and `linkAmount` on each linked tag.
- Cascade deletes outside the service (import revert) can leave a broken ledger; display
  clamps, and `newErrors` ignores pre-existing breakage so later edits are not blocked.

## Entry groups (`entry_groups`)

Several of one friend's entries under one title ("Ketul's wedding"), shown and settled
as one. **A group is only a label over its entries:** it stores no amounts, and
everything about it (`groupFigures` in `friend-ledger.ts`: net total, pending, status)
is derived from its entries. Grouping, ungrouping or moving entries never changes a
balance — settlements still link to the individual entries.

- `transaction_friend_tags.entry_group_id` (FK, `ON DELETE SET NULL`): one group per
  entry. Only `OWES_ME` / `I_OWE` / `NOTHING_OUTSTANDING` entries of the group's friend
  can join; a grouped entry cannot become a settlement or move to another friend.
- Titles are unique per friend, ignoring case and spacing
  (`uq_entry_groups_friend_title` on `lower(btrim(title))`).
- A group left with no entries (removed, deleted, or import revert) is deleted
  (`pruneEmptyGroups`).
- Tag responses carry `entryGroupId` and `entryGroup: { id, title }`.

## Credit-card billing cycles

- `card_transactions.statement_id IS NULL` means **unbilled** — spend made after the
  last statement closed, which has no statement to belong to yet. The web app labels it
  via `cardTxnStatus`. Friend ledgers key off `txn_date`, so unbilled rows export
  normally; never gate a ledger on `statement_id`.
- Never file a transaction into "the next statement". `CardsService.createTransaction`
  resolves the statement from `txn_date` (`resolveStatementForDate`) and leaves it NULL
  when no cycle covers the date.
- All cycle date math lives in `src/cards/card-cycle.ts` (`cycleStartFor`,
  `openCycleRange`). A cycle is `[previous statement date + 1, statement date]`. The
  import path and the live card view both use it — they used to disagree by a day.
- `GET /cards/import-schedule` says which statement to import next per credit card
  (logic in `src/cards/card-import-schedule.ts`, pure and tested). The statement day is
  inferred from past imports; `cards.statement_day` is hand-typed, can be wrong, and is
  only the fallback for a card with no imports. Statements are keyed by month
  (`YYYY-MM`), matching HDFC's `MonYYYY_BilledStatements_<last4>_…` export names. The
  unified preview returns `skippedStatements` when an upload jumps past statements that
  are out but not imported.
- `recomputeStatementTotal` must not overwrite `total_amount` on a statement that has a
  `card_statement_imports` row: the bank's Total Amount Due includes carried-over dues
  and interest with no transaction rows. Only `paid_amount` always recomputes.
- CC import matches parsed rows against existing unbilled rows (`card-txn-match.ts`:
  equal signed paise, `txn_date` within ±3 days) and bills them **in place**. Matched
  rows keep `card_import_id = NULL`, which is what makes revert non-destructive —
  revert deletes by `card_import_id` and un-bills the rest.

- HDFC has no download for unbilled spend, so `POST /cards/:id/unbilled/paste` (and
  `/preview`) take the text copied off its Unbilled Transactions page (`{ text }`).
  `parsers/hdfc-unbilled-paste.parser.ts` rejects a paste whose rows do not add up to
  the page's Total Spent / Total Credited. `CardUnbilledService` inserts only rows not
  already on the card (±1 day, equal paise) and skips dates inside a billed cycle; the
  rows are plain unbilled rows, so the statement import bills them in place.

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
