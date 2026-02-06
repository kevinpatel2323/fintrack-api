import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';
import { TransactionFriendDirection } from '../../database/entities/transaction-friend-tag.entity';

export class CreateTransactionFriendTagDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  friendId!: number;

  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsIn([TransactionFriendDirection.IOwe, TransactionFriendDirection.OwesMe])
  direction!: TransactionFriendDirection;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
