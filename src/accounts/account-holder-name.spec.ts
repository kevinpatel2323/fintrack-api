import { cleanHolderName } from './account-holder-name';

describe('cleanHolderName', () => {
  it('trims and collapses inner spaces', () => {
    expect(cleanHolderName('  Kevin   Patel ')).toBe('Kevin Patel');
    expect(cleanHolderName('Kevin\tPatel\n')).toBe('Kevin Patel');
  });

  it('turns a blank or missing name into null', () => {
    expect(cleanHolderName('')).toBeNull();
    expect(cleanHolderName('   ')).toBeNull();
    expect(cleanHolderName(null)).toBeNull();
    expect(cleanHolderName(undefined)).toBeNull();
  });
});
