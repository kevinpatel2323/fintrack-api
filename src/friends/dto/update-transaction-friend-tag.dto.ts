import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
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
  @IsPositive()
  amount?: number;

  @IsOptional()
  @IsIn([TransactionFriendDirection.IOwe, TransactionFriendDirection.OwesMe])
  direction?: TransactionFriendDirection;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
