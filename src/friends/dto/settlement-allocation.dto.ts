import { Type } from 'class-transformer';
import { IsNumber, IsPositive } from 'class-validator';

/** One entry a settlement pays off, and how much of the settlement goes to it. */
export class SettlementAllocationDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  tagId!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;
}
