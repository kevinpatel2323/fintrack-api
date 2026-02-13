import { Type } from 'class-transformer';
import { IsArray, IsIn, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';
import { TransactionFriendDirection } from '../../database/entities/transaction-friend-tag.entity';

export class CreateTransactionFriendTagDto {
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  friendId!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsIn([
    TransactionFriendDirection.IOwe,
    TransactionFriendDirection.OwesMe,
    TransactionFriendDirection.NothingOutstanding,
    TransactionFriendDirection.Settlement,
  ])
  direction!: TransactionFriendDirection;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @IsPositive({ each: true })
  linkedTransactionIds?: number[];
}
