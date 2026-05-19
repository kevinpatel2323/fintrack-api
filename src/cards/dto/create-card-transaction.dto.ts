import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateCardTransactionDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsString()
  @MaxLength(200)
  merchant!: string;

  @Matches(ISO_DATE, { message: 'txnDate must be YYYY-MM-DD' })
  txnDate!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Matches(/^\d+$/, { message: 'categoryId must be a numeric id string' })
  categoryId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Matches(/^\d+$/, { message: 'statementId must be a numeric id string' })
  statementId?: string | null;

  @IsOptional()
  @IsBoolean()
  isRefund?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdateCardTransactionDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  merchant?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'txnDate must be YYYY-MM-DD' })
  txnDate?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Matches(/^\d+$/, { message: 'categoryId must be a numeric id string' })
  categoryId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Matches(/^\d+$/, { message: 'statementId must be a numeric id string' })
  statementId?: string | null;

  @IsOptional()
  @IsBoolean()
  isRefund?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
