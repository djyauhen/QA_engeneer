import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { SessionGuard, TlGuard } from '../auth/guards';
import { UsersService } from './users.service';

@Controller('admin/users')
@UseGuards(SessionGuard, TlGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown) {
    return this.users.create(body);
  }
}
