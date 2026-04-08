import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class UpdateSubscriptionDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rrule?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'dtstart must be YYYY-MM-DD' })
  dtstart?: string;

  @IsOptional()
  @IsArray()
  @Matches(ISO_DATE, { each: true, message: 'each exdate must be YYYY-MM-DD' })
  exdates?: string[];

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== undefined)
  @IsString()
  @MaxLength(100)
  timezone?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(ISO_DATE, { message: 'trialEndsOn must be YYYY-MM-DD' })
  trialEndsOn?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(ISO_DATE, { message: 'trialStartedOn must be YYYY-MM-DD' })
  trialStartedOn?: string | null;

  @IsOptional()
  @IsBoolean()
  isTrial?: boolean;

  @IsOptional()
  @IsIn(['active', 'paused', 'cancelled'])
  status?: 'active' | 'paused' | 'cancelled';

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(200)
  merchantLabel?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Matches(/^\d+$/, { message: 'categoryId must be a numeric id string' })
  categoryId?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  remindDaysBefore?: number | null;
}
