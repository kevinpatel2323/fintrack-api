import { IsDateString, IsOptional } from 'class-validator';

/**
 * Query params for exporting a category's transactions as CSV.
 * Both bounds are optional — omitting them exports every transaction in the
 * category. Dates are inclusive `YYYY-MM-DD` strings, matching the rest of the
 * API (e.g. the friend ledger export).
 */
export class ExportCategoryTransactionsQueryDto {
  @IsOptional()
  @IsDateString()
  start?: string;

  @IsOptional()
  @IsDateString()
  end?: string;
}
