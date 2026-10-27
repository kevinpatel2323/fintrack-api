import { IsString, MaxLength, MinLength } from 'class-validator';

export class UnbilledPasteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  text!: string;
}
