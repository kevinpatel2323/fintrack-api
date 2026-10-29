import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const MEMO_TABS = ['all', 'no-memo', 'debit', 'credit'] as const;
export type MemoTab = (typeof MEMO_TABS)[number];

export class ListMemosQueryDto {
  @IsOptional()
  @IsIn(MEMO_TABS)
  tab?: MemoTab;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // Up to a whole period at once: the web list sorts and pages it itself, like
  // Transactions does with its date range.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  pageSize?: number;

  // The period, inclusive YYYY-MM-DD, by the transaction's own date (the SMS's
  // arrival day in India when the SMS gave none).
  @IsOptional()
  @Matches(ISO_DAY)
  start?: string;

  @IsOptional()
  @Matches(ISO_DAY)
  end?: string;
}

export class UpdateMemoDto {
  // null (or blank) clears the memo.
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  memo!: string | null;
}

export class CreatePairCodeDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}
