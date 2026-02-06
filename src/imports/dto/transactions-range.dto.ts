import { IsDateString, IsOptional, IsString } from 'class-validator';

export class TransactionsRangeQueryDto {
  @IsDateString()
  start!: string;

  @IsDateString()
  end!: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;
}
