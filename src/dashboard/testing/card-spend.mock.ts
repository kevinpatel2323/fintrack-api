// DashboardService folds credit-card spend into the bank aggregates, so every
// test module has to provide a CardTransaction repository. These specs assert
// bank-side behaviour, so the default mock reports no card spend at all and
// leaves the bank numbers untouched.

type CardSpendRow = {
  categoryId?: string | null;
  categoryName?: string | null;
  categoryColor?: string | null;
  month?: string;
  totalAmount?: string | number;
  totalSpent?: string | number;
  transactionCount?: string | number;
};

export function cardTransactionsRepoWith(rows: CardSpendRow[]) {
  const totals = rows.reduce<{ totalSpent: number; transactionCount: number }>(
    (acc, row) => ({
      totalSpent:
        acc.totalSpent + Number(row.totalSpent ?? row.totalAmount ?? 0),
      transactionCount: acc.transactionCount + Number(row.transactionCount ?? 0),
    }),
    { totalSpent: 0, transactionCount: 0 },
  );

  // Every chainable method returns the builder; only the terminals differ.
  const builder: Record<string, jest.Mock> = {};
  for (const method of [
    'select',
    'addSelect',
    'where',
    'andWhere',
    'leftJoin',
    'innerJoin',
    'groupBy',
    'orderBy',
  ]) {
    builder[method] = jest.fn(() => builder);
  }
  builder.getRawOne = jest.fn(async () => ({
    totalSpent: String(totals.totalSpent),
    transactionCount: String(totals.transactionCount),
  }));
  builder.getRawMany = jest.fn(async () => rows);

  return { createQueryBuilder: jest.fn(() => builder) };
}

export function emptyCardTransactionsRepo() {
  return cardTransactionsRepoWith([]);
}
