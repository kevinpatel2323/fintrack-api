import { IsString, MaxLength, ValidateIf } from 'class-validator';

export class UpdateAccountDto {
  // null (or blank) clears the name; the account shows by its number again.
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100)
  holderName!: string | null;
}
