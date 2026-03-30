import { IsOptional, Matches } from 'class-validator';

export class FriendTransactionsQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'start must be YYYY-MM-DD' })
  start?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'end must be YYYY-MM-DD' })
  end?: string;
}
