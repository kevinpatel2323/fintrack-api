import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateCardControlsDto {
  @IsOptional()
  @IsBoolean()
  onlineEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  contactlessEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  internationalEnabled?: boolean;
}

export class ToggleFreezeDto {
  @IsBoolean()
  frozen!: boolean;
}
