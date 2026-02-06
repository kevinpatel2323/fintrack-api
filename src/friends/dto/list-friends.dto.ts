import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ListFriendsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}
