import { Body, Controller, Get, Param, ParseIntPipe, Patch } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { UpdateAccountDto } from './dto/update-account.dto';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  async list() {
    const data = await this.accountsService.list();
    return { count: data.length, data };
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAccountDto) {
    return this.accountsService.setHolderName(String(id), dto.holderName);
  }
}
