// Runs prompt-rules.json through NSRegularExpression — the engine Shortcuts
// uses — exactly the way build.py wires it into Fintrack Memos, and prints the
// memo prompt for each sample SMS.
//   osascript -l JavaScript scripts/ios-shortcuts/test-prompt.js
ObjC.import('Foundation');

const here = $.NSString.stringWithString($.NSProcessInfo.processInfo.arguments.js.map((a) => a.js).find((a) => a.endsWith('test-prompt.js')) || 'scripts/ios-shortcuts/test-prompt.js').stringByDeletingLastPathComponent.js;
const read = (name) => $.NSString.stringWithContentsOfFileEncodingError(`${here}/${name}`, $.NSUTF8StringEncoding, null).js;
const rules = JSON.parse(read('prompt-rules.json'));
const amountPattern = JSON.parse(read('filter-block.json'))
  .find((a) => (a.WFWorkflowActionParameters || {}).CustomOutputName === 'amountHit').WFWorkflowActionParameters.WFMatchTextPattern;

const CI = $.NSRegularExpressionCaseInsensitive;
const rx = (pattern) => $.NSRegularExpression.regularExpressionWithPatternOptionsError(pattern, CI, null);
const matches = (text, pattern) => {
  const s = $(text);
  return rx(pattern).matchesInStringOptionsRange(s, 0, $.NSMakeRange(0, s.length)).js.map((m) => s.substringWithRange(m.range).js);
};
const replace = (text, pattern, template) => {
  const s = $(text);
  return rx(pattern).stringByReplacingMatchesInStringOptionsRangeWithTemplate(s, 0, $.NSMakeRange(0, s.length), template).js;
};

function prompt(sms) {
  const norm = sms.replace(/\s+/g, ' ');
  const amounts = matches(norm, amountPattern);
  const rupees = amounts.length ? replace(amounts[0], rules.rupee, '₹') : '';
  const words = matches(norm, rules.direction);
  const sign = words.length ? (matches(words[0], rules.credit).length ? '+' : '−') : '';
  let method = '';
  for (const [label, pattern] of rules.methods) if (matches(norm, pattern).length) method = label;
  if (sign === '−' && matches(norm, rules.charge).length) method = 'Bank charge';
  let payee = '';
  for (const pattern of rules.payee) {
    const found = replace(norm, pattern, '$1');
    if (!payee && found !== norm) payee = found;
  }
  payee = replace(payee, rules.payeeMax, '$1…');
  let account = replace(norm, rules.account, '••$1');
  if (account === norm) account = '';
  const bank = matches(norm, rules.bank)[0] || '';
  const lines = [`${sign}${rupees}${method ? ` · ${method}` : ''}`];
  // Who: 'From' for money in, 'At' for an ATM, 'For' for a bank charge, else 'To'.
  const lead = sign === '+' ? 'From' : method === 'ATM' ? 'At' : method === 'Bank charge' ? 'For' : 'To';
  if (payee) lines.push(`${lead} ${payee}`);
  if (bank || account) lines.push([bank, account].filter(Boolean).join(' '));
  return lines.join('\n');
}

const samples = [
  'Sent Rs.10.00\nFrom HDFC Bank A/C *6714\nTo MINAL RAJENDRABHAI PATEL\nOn 30/10/26\nRef 132061008935\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808',
  'Spent Rs.1234 On HDFC Bank Card 2209 At AMAZON On 2026-10-29:12:34:56.Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 2209 to 7308080808',
  'Rs.20.00 has been debited from your HDFC Bank RuPay Credit Card XX9164 to paytmqr281005050101@paytm SURESH TEA STALL on 22-10-26. Your UPI transaction reference number is 529512345678.',
  'Dear Customer, Rs.132.00 is debited from your account ending 6714 towards VPA someone@oksbi (A SHOP) on 21-09-26. UPI transaction reference no.: 129968131323.',
  'Rs.2775.00 has been successfully credited to your HDFC Bank account ending in 6714 from VPA rahul@okicici (UPI 612345678901)',
  'Dear UPI user A/C X1234 debited by 20.0 on date 29Oct26 trf to CHAI POINT Refno 630298765432. If not u? call 1800111109. -SBI',
  'ICICI Bank Acct XX123 debited for Rs 500.00 on 29-Oct-26; ZOMATO credited. UPI:529512345678. Call 18002662 for dispute.',
  'INR 1,234.00 spent using ICICI Bank Card XX4321 on 29-Oct-26 on AMAZON. Avl Limit: INR 1,00,000.00.',
  'INR 500.00 debited\nA/c no. XX1234\n29-10-26, 12:34:56\nUPI/P2M/630212345678/SWIGGY LIMITED\nNot you? SMS BLOCKUPI Cust ID to 919951860002\nAxis Bank',
  'Rs.590.00 has been debited from your HDFC Bank A/c XX6714 towards SMS charges for Jul-Sep 2026.',
  'Rs.2000.00 withdrawn at ATM HDFC0001 from A/c XX6714 on 28-10-26.',
  'Dear Customer, Rs.1,299.00 has been credited to your HDFC Bank Credit Card ending 2209 towards refund from MYNTRA on 20-10-2026.',
  'Received Rs.500.00 in your Kotak Bank AC X1234 from xyz@ybl on 29-10-26.UPI Ref 630212345678.',
  'Money Received - INR 5,000.00 in HDFC Bank A/c XX6714 from RAHUL SHAH on 28-10-26 by NEFT.',
];
samples.map((s) => `${prompt(s)}\n`).join('\n---\n');
