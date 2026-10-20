import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

/** Closes a leftover on an entry or a settlement — Tally's round-off. */
export class CreateWriteOffDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  tagId!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
