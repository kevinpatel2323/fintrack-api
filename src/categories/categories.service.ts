import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from '../database/entities/category.entity';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category)
    private readonly categoriesRepository: Repository<Category>,
  ) {}

  async create(dto: CreateCategoryDto): Promise<Category> {
    const existing = await this.categoriesRepository.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException(`Category "${dto.name}" already exists.`);
    }

    const category = new Category();
    category.name = dto.name;
    category.color = dto.color ?? null;
    category.icon = dto.icon ?? null;
    return this.categoriesRepository.save(category);
  }

  async findAll(): Promise<Array<Category & { transactionCount: number }>> {
    const rows = await this.categoriesRepository
      .createQueryBuilder('c')
      .loadRelationCountAndMap('c.transactionCount', 'c.transactions')
      .orderBy('c.name', 'ASC')
      .getMany();

    return rows as Array<Category & { transactionCount: number }>;
  }

  async findOne(id: string): Promise<Category> {
    const category = await this.categoriesRepository.findOne({ where: { id } });
    if (!category) throw new NotFoundException('Category not found.');
    return category;
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<Category> {
    const category = await this.findOne(id);

    if (dto.name && dto.name !== category.name) {
      const existing = await this.categoriesRepository.findOne({ where: { name: dto.name } });
      if (existing) {
        throw new ConflictException(`Category "${dto.name}" already exists.`);
      }
    }

    if (dto.name !== undefined) category.name = dto.name;
    if (dto.color !== undefined) category.color = dto.color ?? null;
    if (dto.icon !== undefined) category.icon = dto.icon ?? null;

    return this.categoriesRepository.save(category);
  }

  async remove(id: string): Promise<{ deleted: boolean; id: string }> {
    await this.findOne(id); // throws 404 if not found
    await this.categoriesRepository.delete({ id });
    return { deleted: true, id };
  }
}
