import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNumber,
  IsPositive,
  ValidateNested,
} from 'class-validator';
import { SettlementAllocationDto } from './settlement-allocation.dto';

export class LegacySettlementReviewDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  settlementTagId!: number;

  /** The amounts this settlement really applied. An empty list leaves it all on account. */
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SettlementAllocationDto)
  allocations!: SettlementAllocationDto[];
}

/** Gives every one of a friend's amount-less settlements real amounts, in one go. */
export class ApplyLegacyReviewDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => LegacySettlementReviewDto)
  settlements!: LegacySettlementReviewDto[];
}
