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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { TransactionFriendDirection } from '../../database/entities/transaction-friend-tag.entity';
import { SettlementAllocationDto } from './settlement-allocation.dto';

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
    TransactionFriendDirection.Settlement,
  ])
  direction?: TransactionFriendDirection;

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

  /**
   * Replaces the settlement's allocations — including any old amount-less
   * links — with these. An empty list puts the whole settlement on account.
   * Omit it to leave the allocations untouched.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => SettlementAllocationDto)
  allocations?: SettlementAllocationDto[];

  /** The entry group to put this entry in; null takes it out of its group. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Type(() => Number)
  @IsNumber()
  @IsPositive()
  entryGroupId?: number | null;
}
