import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, Min, MinLength, ValidateIf } from 'class-validator';

export class CreateManualTransactionDto {
  @IsDateString()
  transactionDate!: string;

  @IsOptional()
  @IsString()
  accountNumber?: string;

  @IsString()
  @MinLength(1)
  narration!: string;

  @IsIn(['PAID', 'RECEIVED', 'I_OWE', 'SETTLEMENT'])
  type!: 'PAID' | 'RECEIVED' | 'I_OWE' | 'SETTLEMENT';

  @ValidateIf((dto) => dto.type === 'SETTLEMENT')
  @IsIn(['WITHDRAWAL', 'DEPOSIT'])
  settlementDirection?: 'WITHDRAWAL' | 'DEPOSIT';

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsOptional()
  balance?: number;

  @IsOptional()
  @IsString()
  upiName?: string;

  @IsOptional()
  @IsString()
  upiDescription?: string;

  @IsOptional()
  @IsString()
  upiBank?: string;
}
