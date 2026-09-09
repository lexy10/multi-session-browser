import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ControlGateway } from '../realtime/control.gateway';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class UsersController {
  constructor(private users: UsersService, private control: ControlGateway) {}

  @Get()
  findAll(@Query('page') page?: string, @Query('limit') limit?: string, @Query('q') q?: string) {
    return this.users.findAll({ page: parseInt(page || '1', 10), limit: parseInt(limit || '25', 10), q: q || '' });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthUser) {
    if (id === actor.id && (dto.locked === true || dto.active === false)) {
      throw new BadRequestException('You cannot lock or disable your own account');
    }
    const target = await this.users.findOne(id);
    if (target.role === 'ADMIN' && dto.locked === true) {
      throw new BadRequestException('Admins cannot be locked');
    }
    if (target.role === 'ADMIN' && dto.active === false) {
      throw new BadRequestException('Admins cannot be disabled');
    }
    const updated = await this.users.update(id, dto);
    // Reflect lock changes to the user's live clients immediately.
    if (dto.locked === true) this.control.lockUser(id);
    if (dto.locked === false) this.control.unlockUser(id);
    if (dto.active === false) this.control.forceLogout(id);
    return updated;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    const target = await this.users.findOne(id);
    if (target.role === 'ADMIN') {
      throw new BadRequestException('Admins cannot be deleted — change the role to User first');
    }
    this.control.forceLogout(id);
    return this.users.remove(id, actor.id);
  }
}
