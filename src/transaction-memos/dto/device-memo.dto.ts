import { Type } from 'class-transformer';
import {
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class DeviceLocationDto {
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;
}

// The phone's own filter verdict, kept for debugging the on-phone rules.
export class DeviceFilterDto {
  @IsOptional()
  @Type(() => String)
  @IsString()
  @MaxLength(8)
  version?: string;

  @IsOptional()
  @Type(() => String)
  @IsString()
  @MaxLength(8)
  senderRecognised?: string;
}

/**
 * What the Fintrack Memos shortcut sends for one outbox file. With `message`
 * it is a captured SMS (and maybe its memo); without, a memo for an SMS already
 * sent under the same `submissionId`. A Shortcuts dictionary may send any
 * value as text, a number or a boolean, so each is converted to the type here.
 */
export class DeviceMemoDto {
  @IsString()
  @Matches(/^[A-Za-z0-9._:-]{6,80}$/)
  submissionId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  memo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sender?: string;

  @IsOptional()
  @IsISO8601()
  receivedAt?: string;

  @IsOptional()
  @IsISO8601()
  capturedAt?: string;

  @IsOptional()
  @Type(() => String)
  @IsString()
  @MaxLength(16)
  shortcutVersion?: string;

  @IsOptional()
  @Type(() => String)
  @IsString()
  @MaxLength(8)
  contractVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(24)
  locationStatus?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceLocationDto)
  location?: DeviceLocationDto;

  // The shortcut adds the location after the first save as two flat keys: a
  // nested dictionary set later in Shortcuts can arrive as a JSON string.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeviceFilterDto)
  filter?: DeviceFilterDto;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  outboxCount?: number;
}

export class PairDeviceDto {
  @IsString()
  @MaxLength(64)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;
}
