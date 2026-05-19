import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class CreateCardDto {
  @IsIn(['credit', 'debit'])
  kind!: 'credit' | 'debit';

  @IsString()
  @MaxLength(50)
  bank!: string;

  @IsString()
  @MaxLength(50)
  network!: string;

  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  nickname?: string | null;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'last4 must be exactly 4 digits' })
  last4!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  expiryMonth!: number;

  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  expiryYear!: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  holder?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  palette?: string;

  // Credit-only fields
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  creditLimit?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  statementDay?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number | null;

  // Debit-only fields
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(50)
  linkedAccountNumber?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  dailyLimit?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  atmLimit?: number | null;

  // Rewards
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(80)
  pointsLabel?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pointsBalance?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  pointsValue?: number;

  // Controls
  @IsOptional()
  @IsBoolean()
  frozen?: boolean;

  @IsOptional()
  @IsBoolean()
  onlineEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  contactlessEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  internationalEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
