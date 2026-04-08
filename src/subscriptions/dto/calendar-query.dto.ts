import { Matches } from 'class-validator';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CalendarQueryDto {
  @Matches(ISO_DATE, { message: 'start must be YYYY-MM-DD' })
  start!: string;

  @Matches(ISO_DATE, { message: 'end must be YYYY-MM-DD' })
  end!: string;
}
