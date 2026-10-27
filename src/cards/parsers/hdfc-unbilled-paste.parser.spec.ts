import { parseHdfcUnbilledPaste } from './hdfc-unbilled-paste.parser';

// Copied off HDFC MyCards' Unbilled Transactions page (trimmed).
const PAGE = `Unbilled Transactions
View all your unbilled transactions here

Settled
Unsettled
Total Spent
₹19,314.00
debit icon
Total Credited
₹0.00
credit icon
Note:
Convert up to 10 transactions of ₹2,500 each into SmartEMI at once.
Date    Details    Amount    
25 Oct 2026    
Upi-four Coffee
₹735.00    debit icon
19 Oct 2026    
Upi-v M Cafe
₹20.00    debit icon

18 Oct 2026    
Upi-allevents Informations Pv
ELIGIBLE FOR SMARTEMI
₹14,047.20    debit icon

18 Oct 2026    
Upi-allevents Informations Pv
ELIGIBLE FOR SMARTEMI
₹4,511.80    debit icon
`;

describe('parseHdfcUnbilledPaste', () => {
  it('reads every row and checks them against the page totals', () => {
    const result = parseHdfcUnbilledPaste(PAGE);
    expect(result.totalSpent).toBe(19314);
    expect(result.totalCredited).toBe(0);
    expect(result.entries).toEqual([
      { txnDate: '2026-10-25', merchant: 'Upi-four Coffee', amount: 735, isRefund: false },
      { txnDate: '2026-10-19', merchant: 'Upi-v M Cafe', amount: 20, isRefund: false },
      { txnDate: '2026-10-18', merchant: 'Upi-allevents Informations Pv', amount: 14047.2, isRefund: false },
      { txnDate: '2026-10-18', merchant: 'Upi-allevents Informations Pv', amount: 4511.8, isRefund: false },
    ]);
  });

  it('rejects a paste whose rows do not add up to Total Spent', () => {
    const partial = PAGE.replace(/19 Oct 2026[\s\S]*?debit icon/, '');
    expect(() => parseHdfcUnbilledPaste(partial)).toThrow(/Total Spent/);
  });

  it('treats credit-icon rows as refunds', () => {
    const text = `Total Credited\n₹99.00\n21 Oct 2026\nRefund Zepto\n₹99.00 credit icon`;
    expect(parseHdfcUnbilledPaste(text).entries[0]).toMatchObject({ isRefund: true, amount: 99 });
  });

  it('accepts a list without the totals header', () => {
    expect(parseHdfcUnbilledPaste('20 Oct 2026\nUpi-zepto\n₹190.00 debit icon').entries).toHaveLength(1);
  });

  it('rejects text with no transactions', () => {
    expect(() => parseHdfcUnbilledPaste('hello')).toThrow(/No transactions/);
  });
});
