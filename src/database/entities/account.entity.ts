import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'accounts' })
export class Account {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'account_number', type: 'text' })
  accountNumber!: string;

  // The name shown for the account everywhere in the app; NULL until the user
  // names it, and the number is shown instead.
  @Column({ name: 'holder_name', type: 'text', nullable: true })
  holderName!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
