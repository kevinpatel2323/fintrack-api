import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Bundles several of a friend's entries under one title. */
export class CreateEntryGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(500)
  @Type(() => Number)
  @IsNumber({}, { each: true })
  @IsPositive({ each: true })
  tagIds!: number[];
}

/** Renames a group and/or moves entries in or out of it. */
export class UpdateEntryGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @Type(() => Number)
  @IsNumber({}, { each: true })
  @IsPositive({ each: true })
  addTagIds?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @Type(() => Number)
  @IsNumber({}, { each: true })
  @IsPositive({ each: true })
  removeTagIds?: number[];
}
