import { BadRequestException } from '@nestjs/common';
import { parseConfirmedMatches } from './card-imports.service';

describe('parseConfirmedMatches', () => {
  it('treats an absent field as "no review happened"', () => {
    expect(parseConfirmedMatches(undefined)).toBeUndefined();
    expect(parseConfirmedMatches('')).toBeUndefined();
  });

  it('reads a well-formed list', () => {
    expect(
      parseConfirmedMatches('[{"parsedIndex":0,"existingId":"7"}]'),
    ).toEqual([{ parsedIndex: 0, existingId: '7' }]);
  });

  it('distinguishes an empty list from an absent field', () => {
    // An empty array means "the user unticked everything" — merge nothing.
    expect(parseConfirmedMatches('[]')).toEqual([]);
  });

  it('coerces a numeric id sent as a number', () => {
    expect(
      parseConfirmedMatches('[{"parsedIndex":2,"existingId":42}]'),
    ).toEqual([{ parsedIndex: 2, existingId: '42' }]);
  });

  it('rejects malformed JSON', () => {
    expect(() => parseConfirmedMatches('{oops')).toThrow(BadRequestException);
  });

  it('rejects a non-array payload', () => {
    expect(() => parseConfirmedMatches('{"parsedIndex":0}')).toThrow(
      BadRequestException,
    );
  });

  it('rejects a negative or fractional index', () => {
    expect(() =>
      parseConfirmedMatches('[{"parsedIndex":-1,"existingId":"7"}]'),
    ).toThrow(BadRequestException);
    expect(() =>
      parseConfirmedMatches('[{"parsedIndex":1.5,"existingId":"7"}]'),
    ).toThrow(BadRequestException);
  });

  it('rejects a non-numeric id', () => {
    expect(() =>
      parseConfirmedMatches('[{"parsedIndex":0,"existingId":"7; DROP TABLE"}]'),
    ).toThrow(BadRequestException);
    expect(() => parseConfirmedMatches('[{"parsedIndex":0}]')).toThrow(
      BadRequestException,
    );
  });

  it('rejects an oversized list', () => {
    const huge = JSON.stringify(
      Array.from({ length: 5001 }, (_, i) => ({
        parsedIndex: i,
        existingId: String(i),
      })),
    );
    expect(() => parseConfirmedMatches(huge)).toThrow(BadRequestException);
  });
});
