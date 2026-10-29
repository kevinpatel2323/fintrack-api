import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';

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

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
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
