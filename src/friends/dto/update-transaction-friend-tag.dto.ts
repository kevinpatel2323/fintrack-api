import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';
import { TransactionFriendDirection } from '../../database/entities/transaction-friend-tag.entity';

export class UpdateTransactionFriendTagDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  friendId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsIn([
    TransactionFriendDirection.IOwe,
    TransactionFriendDirection.OwesMe,
    TransactionFriendDirection.NothingOutstanding,
  ])
  direction?: TransactionFriendDirection;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
