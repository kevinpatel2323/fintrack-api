import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsPositive,
  ValidateNested,
} from 'class-validator';

export class LedgerPreferenceDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  tagId!: number;

  /**
   * TRUE/FALSE pin the tag in or out of future ledger exports. Null — or an
   * omitted field — forgets the pin and lets the tag fall back to the default.
   * `@IsOptional` short-circuits on null, which is exactly the pass-through we
   * want here.
   */
  @IsOptional()
  @IsBoolean()
  included?: boolean | null;
}

export class UpdateLedgerPreferencesDto {
  @IsArray()
  // The picker sends one entry per visible row; a statement period that large
  // is already past the point of being a useful export.
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => LedgerPreferenceDto)
  preferences!: LedgerPreferenceDto[];
}
