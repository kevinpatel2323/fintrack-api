import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateCardStatementDto {
  @Matches(ISO_DATE, { message: 'cycleStart must be YYYY-MM-DD' })
  cycleStart!: string;

  @Matches(ISO_DATE, { message: 'cycleEnd must be YYYY-MM-DD' })
  cycleEnd!: string;

  @Matches(ISO_DATE, { message: 'dueDate must be YYYY-MM-DD' })
  dueDate!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minDue?: number;

  @IsOptional()
  @IsIn(['open', 'closed', 'paid', 'overdue'])
  status?: 'open' | 'closed' | 'paid' | 'overdue';

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}

export class UpdateCardStatementDto {
  @IsOptional()
  @Matches(ISO_DATE, { message: 'cycleStart must be YYYY-MM-DD' })
  cycleStart?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'cycleEnd must be YYYY-MM-DD' })
  cycleEnd?: string;

  @IsOptional()
  @Matches(ISO_DATE, { message: 'dueDate must be YYYY-MM-DD' })
  dueDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  totalAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minDue?: number;

  @IsOptional()
  @IsIn(['open', 'closed', 'paid', 'overdue'])
  status?: 'open' | 'closed' | 'paid' | 'overdue';

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
