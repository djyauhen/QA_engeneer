import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
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

  @Post(':login/block')
  @HttpCode(200)
  block(@Param('login') login: string, @Body() body: unknown) {
    return this.users.setBlocked(login, body);
  }

  @Post(':login/password')
  @HttpCode(200)
  password(@Param('login') login: string, @Body() body: unknown) {
    return this.users.changePassword(login, body);
  }
}
