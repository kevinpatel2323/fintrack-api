import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from '../database/entities/category.entity';
import { Subscription } from '../database/entities/subscription.entity';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { UpdateSubscriptionDto } from './dto/update-subscription.dto';
import {
  expandOccurrenceDates,
  MAX_OCCURRENCES_TOTAL,
  parseIsoDateToUtcNoon,
  validateRrule,
} from './subscription-rrule.util';

export type CalendarOccurrence = {
  subscriptionId: string;
  date: string;
  amount: number;
  name: string;
  status: string;
  isTrial: boolean;
  trialEndsOn: string | null;
  merchantLabel: string | null;
  categoryId: string | null;
};

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(Subscription)
    private readonly subscriptionsRepository: Repository<Subscription>,
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
  ) {}

  private async assertCategoryExists(categoryId: string | null | undefined): Promise<void> {
    if (categoryId === undefined || categoryId === null) return;
    const cat = await this.categoriesRepository.findOne({ where: { id: categoryId } });
    if (!cat) throw new BadRequestException('Category not found.');
  }

  private validateDateRange(start: string, end: string): void {
    try {
      const a = parseIsoDateToUtcNoon(start);
      const b = parseIsoDateToUtcNoon(end);
      if (b < a) throw new BadRequestException('end must be on or after start.');
    } catch (e) {
      if (e instanceof BadRequestException) throw e;
      throw new BadRequestException('Invalid date range.');
    }
  }

  async create(dto: CreateSubscriptionDto): Promise<Subscription> {
    await this.assertCategoryExists(dto.categoryId ?? null);
    try {
      validateRrule(dto.rrule, dto.dtstart);
    } catch {
      throw new BadRequestException('Invalid RRULE or dtstart; could not build recurrence rule.');
    }

    const sub = new Subscription();
    sub.name = dto.name;
    sub.amount = dto.amount;
    sub.rrule = dto.rrule.trim();
    sub.dtstart = dto.dtstart;
    sub.exdates = dto.exdates ?? [];
    sub.timezone = dto.timezone ?? null;
    sub.trialEndsOn = dto.trialEndsOn ?? null;
    sub.trialStartedOn = dto.trialStartedOn ?? null;
    sub.isTrial = dto.isTrial ?? false;
    sub.status = dto.status ?? 'active';
    sub.notes = dto.notes ?? null;
    sub.merchantLabel = dto.merchantLabel ?? null;
    sub.categoryId = dto.categoryId ?? null;
    sub.remindDaysBefore = dto.remindDaysBefore ?? null;
    return this.subscriptionsRepository.save(sub);
  }

  async findAll(): Promise<Subscription[]> {
    return this.subscriptionsRepository.find({
      relations: ['category'],
      order: { name: 'ASC' },
    });
  }

  async findOne(id: string): Promise<Subscription> {
    const sub = await this.subscriptionsRepository.findOne({
      where: { id },
      relations: ['category'],
    });
    if (!sub) throw new NotFoundException('Subscription not found.');
    return sub;
  }

  async update(id: string, dto: UpdateSubscriptionDto): Promise<Subscription> {
    const sub = await this.findOne(id);
    if (dto.categoryId !== undefined) await this.assertCategoryExists(dto.categoryId);

    const nextRrule = dto.rrule ?? sub.rrule;
    const nextDtstart = dto.dtstart ?? sub.dtstart;
    try {
      validateRrule(nextRrule, nextDtstart);
    } catch {
      throw new BadRequestException('Invalid RRULE or dtstart; could not build recurrence rule.');
    }

    if (dto.name !== undefined) sub.name = dto.name;
    if (dto.amount !== undefined) sub.amount = dto.amount;
    if (dto.rrule !== undefined) sub.rrule = dto.rrule.trim();
    if (dto.dtstart !== undefined) sub.dtstart = dto.dtstart;
    if (dto.exdates !== undefined) sub.exdates = dto.exdates;
    if (dto.timezone !== undefined) sub.timezone = dto.timezone ?? null;
    if (dto.trialEndsOn !== undefined) sub.trialEndsOn = dto.trialEndsOn ?? null;
    if (dto.trialStartedOn !== undefined) sub.trialStartedOn = dto.trialStartedOn ?? null;
    if (dto.isTrial !== undefined) sub.isTrial = dto.isTrial;
    if (dto.status !== undefined) sub.status = dto.status;
    if (dto.notes !== undefined) sub.notes = dto.notes ?? null;
    if (dto.merchantLabel !== undefined) sub.merchantLabel = dto.merchantLabel ?? null;
    if (dto.categoryId !== undefined) sub.categoryId = dto.categoryId ?? null;
    if (dto.remindDaysBefore !== undefined) sub.remindDaysBefore = dto.remindDaysBefore ?? null;

    return this.subscriptionsRepository.save(sub);
  }

  async remove(id: string): Promise<{ deleted: boolean; id: string }> {
    await this.findOne(id);
    await this.subscriptionsRepository.delete({ id });
    return { deleted: true, id };
  }

  async getCalendar(start: string, end: string): Promise<{
    count: number;
    start: string;
    end: string;
    data: CalendarOccurrence[];
  }> {
    this.validateDateRange(start, end);
    const subs = await this.subscriptionsRepository.find({
      where: { status: 'active' },
    });
    const data: CalendarOccurrence[] = [];
    for (const sub of subs) {
      let dates: string[];
      try {
        dates = expandOccurrenceDates(sub.rrule, sub.dtstart, sub.exdates ?? [], start, end);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Invalid recurrence.';
        throw new BadRequestException(`Subscription "${sub.name}" (id ${sub.id}): ${msg}`);
      }
      for (const date of dates) {
        data.push({
          subscriptionId: sub.id,
          date,
          amount: sub.amount,
          name: sub.name,
          status: sub.status,
          isTrial: sub.isTrial,
          trialEndsOn: sub.trialEndsOn,
          merchantLabel: sub.merchantLabel,
          categoryId: sub.categoryId,
        });
        if (data.length > MAX_OCCURRENCES_TOTAL) {
          throw new BadRequestException(
            `Too many total occurrences in range (>${MAX_OCCURRENCES_TOTAL}). Narrow the date range.`,
          );
        }
      }
    }
    data.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    return { count: data.length, start, end, data };
  }
}
