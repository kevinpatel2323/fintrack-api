import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TransactionFriendDirection } from '../../database/entities/transaction-friend-tag.entity';
import { SettlementAllocationDto } from './settlement-allocation.dto';

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

  /** Links whole entries without amounts — the pre-allocation form, kept for old clients. */
  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  @IsPositive({ each: true })
  linkedTransactionIds?: number[];

  /** For a SETTLEMENT: how much of it pays off each entry. Whatever is left stays on account. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SettlementAllocationDto)
  allocations?: SettlementAllocationDto[];

  /** The friend's entry group to put this entry in ("Ketul's wedding"). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  entryGroupId?: number;
}
