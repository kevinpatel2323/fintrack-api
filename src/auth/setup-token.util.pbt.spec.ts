import fc from 'fast-check';
import { safeEqual } from './setup-token.util';

describe('safeEqual (property-based)', () => {
  it('agrees with === for all string pairs', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        expect(safeEqual(a, b)).toBe(a === b);
      }),
    );
  });

  it('is reflexive', () => {
    fc.assert(
      fc.property(fc.string(), (a) => {
        expect(safeEqual(a, a)).toBe(true);
      }),
    );
  });

  it('never throws, even on length mismatches', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        expect(() => safeEqual(a, b)).not.toThrow();
      }),
    );
  });
});
