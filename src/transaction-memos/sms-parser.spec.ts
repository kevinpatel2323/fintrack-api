import { isOtpMessage, parseSms, readSmsDate, SmsParseResult } from './sms-parser';

const ARRIVED = new Date('2026-10-29T09:00:00Z');
const read = (text: string, receivedAt = ARRIVED, senderBank: string | null = null): SmsParseResult =>
  parseSms({ text, receivedAt, senderBank });

describe('parseSms: credit cards', () => {
  it('reads the classic HDFC "thank you for using" alert', () => {
    const r = read(
      'Dear Card Member, Thank you for using your HDFC Bank Credit Card ending 2209 for Rs 1,250.00 at AMAZON PAY INDIA on 22-10-2026 14:05:33. Authorization code:- 012345',
    );
    expect(r.status).toBe('parsed');
    expect(r.fields).toMatchObject({
      direction: 'debit', channel: 'card', amount: 1250, currency: 'INR', bank: 'hdfc',
      instrument: 'card', last4: '2209', merchant: 'AMAZON PAY INDIA', txnDate: '2026-10-22',
    });
  });

  it('reads the "is debited … towards" wording', () => {
    const r = read('Rs.450.00 is debited from your HDFC Bank Credit Card ending 2209 towards SWIGGY on 21 Oct, 2026 at 21:14:02.');
    expect(r.fields).toMatchObject({ direction: 'debit', amount: 450, last4: '2209', merchant: 'SWIGGY', txnDate: '2026-10-21' });
  });

  it('reads the short "Spent … On … Card … At" SMS', () => {
    const r = read('Spent Rs.1234 On HDFC Bank Card 2209 At AMAZON On 2026-10-29:12:34:56.Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 2209 to 7308080808');
    expect(r.status).toBe('parsed');
    expect(r.fields).toMatchObject({ direction: 'debit', amount: 1234, last4: '2209', merchant: 'AMAZON', txnDate: '2026-10-29', channel: 'card' });
  });

  it('reads a RuPay credit card UPI spend, preferring the name over the handle', () => {
    const r = read(
      'Rs.20.00 has been debited from your HDFC Bank RuPay Credit Card XX9164 to paytmqr281005050101@paytm SURESH TEA STALL on 22-10-26. Your UPI transaction reference number is 529512345678.',
    );
    expect(r.fields).toMatchObject({
      direction: 'debit', channel: 'upi', instrument: 'card', last4: '9164', amount: 20,
      merchant: 'SURESH TEA STALL', vpa: 'paytmqr281005050101@paytm', reference: '529512345678', txnDate: '2026-10-22',
    });
  });

  it('reads an ICICI spend and skips the available limit', () => {
    const r = read('INR 1,234.00 spent using ICICI Bank Card XX4321 on 29-Oct-26 on AMAZON. Avl Limit: INR 1,00,000.00. If not you, call 1800 2662/SMS BLOCK 4321 to 9215676766.');
    expect(r.fields).toMatchObject({ amount: 1234, bank: 'icici', last4: '4321', merchant: 'AMAZON', direction: 'debit' });
  });

  it('reads a refund credited to the card', () => {
    const r = read('Dear Customer, Rs.1,299.00 has been credited to your HDFC Bank Credit Card ending 2209 towards refund from MYNTRA on 20-10-2026.');
    expect(r.fields).toMatchObject({ direction: 'credit', amount: 1299, last4: '2209', merchant: 'MYNTRA', txnDate: '2026-10-20' });
  });

  it('is not fooled by a "never share your OTP" footer', () => {
    const text = 'Rs.450.00 is debited from your HDFC Bank Credit Card ending 2209 towards SWIGGY on 21 Oct, 2026. Never share your OTP, PIN or password with anyone. Call 1800 202 6161 to report.';
    expect(isOtpMessage(text)).toBe(false);
    expect(read(text).status).toBe('parsed');
  });
});

describe('parseSms: bank accounts and UPI', () => {
  it('reads the multi-line HDFC "Sent" UPI SMS', () => {
    const r = read('Sent Rs.500.00\nFrom HDFC Bank A/C *6714\nTo RAHUL SHAH\nOn 29/10/26\nRef 630212345678\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808');
    expect(r.status).toBe('parsed');
    expect(r.fields).toMatchObject({
      direction: 'debit', channel: 'upi', instrument: 'account', last4: '6714', amount: 500,
      merchant: 'RAHUL SHAH', reference: '630212345678', txnDate: '2026-10-29', bank: 'hdfc',
    });
  });

  it('reads an account UPI debit with the shop name after the handle', () => {
    const r = read(
      'Dear Customer, Rs.132.00 is debited from your account ending 6714 towards VPA someone@oksbi (A SHOP) on 21-09-26. UPI transaction reference no.: 129968131323.',
      new Date('2026-09-21T10:00:00Z'),
    );
    expect(r.fields).toMatchObject({
      instrument: 'account', last4: '6714', merchant: 'A SHOP', vpa: 'someone@oksbi',
      reference: '129968131323', channel: 'upi', txnDate: '2026-09-21',
    });
  });

  it('reads money received, naming the payer', () => {
    const r = read('Rs.2775.00 has been successfully credited to your HDFC Bank account ending in 6714 from VPA rahul@okicici (UPI 612345678901)');
    expect(r.fields).toMatchObject({
      direction: 'credit', amount: 2775, instrument: 'account', last4: '6714',
      vpa: 'rahul@okicici', merchant: 'rahul@okicici', reference: '612345678901', channel: 'upi',
    });
  });

  it('reads Kotak "Received … from" with a handle', () => {
    const r = read('Received Rs.500.00 in your Kotak Bank AC X1234 from xyz@ybl on 29-10-26.UPI Ref 630212345678.');
    expect(r.fields).toMatchObject({ direction: 'credit', bank: 'kotak', last4: '1234', vpa: 'xyz@ybl', reference: '630212345678' });
  });

  it('reads SBI "debited by" with no currency and a squashed date', () => {
    const r = read('Dear UPI user A/C X1234 debited by 20.0 on date 29Oct26 trf to CHAI POINT Refno 630298765432. If not u? call 1800111109. -SBI', ARRIVED, 'sbi');
    expect(r.status).toBe('parsed');
    expect(r.fields).toMatchObject({
      amount: 20, currency: 'INR', direction: 'debit', last4: '1234', merchant: 'CHAI POINT',
      txnDate: '2026-10-29', reference: '630298765432', bank: 'sbi',
    });
  });

  it('reads ICICI "debited …; NAME credited"', () => {
    const r = read('ICICI Bank Acct XX123 debited for Rs 500.00 on 29-Oct-26; ZOMATO credited. UPI:529512345678. Call 18002662 for dispute.');
    expect(r.fields).toMatchObject({ direction: 'debit', last4: '123', merchant: 'ZOMATO', reference: '529512345678', amount: 500 });
  });

  it('reads Axis "UPI/P2M/…/NAME"', () => {
    const r = read('INR 500.00 debited\nA/c no. XX1234\n29-10-26, 12:34:56\nUPI/P2M/630212345678/SWIGGY LIMITED\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank');
    expect(r.fields).toMatchObject({ direction: 'debit', amount: 500, last4: '1234', merchant: 'SWIGGY LIMITED', bank: 'axis', txnDate: '2026-10-29' });
  });

  it('reads bank charges as a charge', () => {
    const r = read('Rs.590.00 has been debited from your HDFC Bank A/c XX6714 towards SMS charges for Jul-Sep 2026.');
    expect(r.fields).toMatchObject({ direction: 'debit', channel: 'charge', amount: 590, last4: '6714' });
  });

  it('reads an ATM withdrawal', () => {
    const r = read('Rs.2000.00 withdrawn at ATM HDFC0001 from A/c XX6714 on 28-10-26.');
    expect(r.fields).toMatchObject({ direction: 'debit', channel: 'atm', amount: 2000, last4: '6714', txnDate: '2026-10-28' });
  });

  it('skips a balance printed before the amount', () => {
    const r = read('Your A/c XX6714 has Avl Bal of Rs 5,000.00 after Rs 200.00 debited at CAFE on 29-10-26.');
    expect(r.fields.amount).toBe(200);
  });
});

describe('parseSms: what it cannot fully read', () => {
  it('keeps a declined transaction as partial, saying why', () => {
    const r = read('Your transaction of Rs 450.00 at AMAZON on HDFC Bank Credit Card ending 2209 was declined due to incorrect PIN.');
    expect(r.status).toBe('partial');
    expect(r.error).toMatch(/declined/);
  });

  it('marks a message with neither amount nor wording unreadable', () => {
    const r = read('Your HDFC Bank e-statement is ready to view.');
    expect(r.status).toBe('unreadable');
    expect(r.fields.amount).toBeNull();
  });

  it('uses the arrival day when the text has no date, or an implausible one', () => {
    expect(read('Rs 300 debited from your HDFC Bank Credit Card XX2209 at ZOMATO.').fields.txnDate).toBe('2026-10-29');
    expect(read('Rs 300 debited from Credit Card XX2209 at ZOMATO on 22-10-2019.').fields.txnDate).toBe('2026-10-29');
  });

  it('never throws on noise', () => {
    for (const text of ['', ' ', '₹', 'Rs.', '@@@', 'a/c', 'x'.repeat(2000)]) {
      expect(() => read(text)).not.toThrow();
    }
  });
});

describe('isOtpMessage', () => {
  it.each([
    '123456 is the OTP for your transaction of Rs 450 at AMAZON on HDFC Bank Credit Card ending 2209. Valid for 5 mins.',
    'OTP for txn of INR 450.00 at AMAZON on card ending 2209 is 482913.',
    'Your verification code is 482913. Do not share it.',
    'Use 4821 to log in to NetBanking.',
    '482913 is your one time password for login.',
  ])('refuses %s', (text) => {
    expect(isOtpMessage(text)).toBe(true);
  });

  it('lets an ordinary alert through', () => {
    expect(isOtpMessage('Sent Rs.500.00 From HDFC Bank A/C *6714 To RAHUL SHAH On 29/10/26 Ref 630212345678')).toBe(false);
  });
});

describe('readSmsDate', () => {
  it.each([
    ['22-10-26', '2026-10-22'],
    ['22/10/2026', '2026-10-22'],
    ['22 Oct, 2026', '2026-10-22'],
    ['22-Oct-26', '2026-10-22'],
    ['29Oct26', '2026-10-29'],
    ['Oct 22, 2026', '2026-10-22'],
    ['2026-10-22', '2026-10-22'],
  ])('reads %s', (raw, iso) => {
    expect(readSmsDate(raw)).toBe(iso);
  });

  it('rejects impossible dates', () => {
    expect(readSmsDate('31-02-26')).toBeNull();
    expect(readSmsDate('nonsense')).toBeNull();
  });
});
