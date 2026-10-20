import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { SettlementAllocationDto } from './settlement-allocation.dto';

/**
 * Nets entries of the two sides against each other with no money moving. The
 * lines on what the friend owes and on what the user owes must add up to the
 * same amount.
 */
export class CreateOffsetDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SettlementAllocationDto)
  lines!: SettlementAllocationDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
