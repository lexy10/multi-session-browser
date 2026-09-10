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
import { ClientIp } from '../common/client-ip.decorator';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ControlGateway } from '../realtime/control.gateway';
import { AuditService } from '../audit/audit.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class UsersController {
  constructor(
    private users: UsersService,
    private control: ControlGateway,
    private audit: AuditService,
  ) {}

  @Get()
  findAll(@Query('page') page?: string, @Query('limit') limit?: string, @Query('q') q?: string) {
    return this.users.findAll({ page: parseInt(page || '1', 10), limit: parseInt(limit || '25', 10), q: q || '' });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Post()
  async create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthUser, @ClientIp() ip: string) {
    const created = await this.users.create(dto);
    await this.audit.record({
      action: 'USER_CREATE',
      actorId: actor.id,
      actorName: actor.username,
      targetType: 'USER',
      targetId: created?.id,
      detail: `Created ${dto.role || 'USER'} "${dto.username}"`,
      ip,
    });
    return created;
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthUser,
    @ClientIp() ip: string,
  ) {
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
    await this.audit.record({
      action: 'USER_UPDATE',
      actorId: actor.id,
      actorName: actor.username,
      targetType: 'USER',
      targetId: id,
      detail: `Updated "${target.username}": ${summarizeChanges(dto)}`,
      ip,
    });
    return updated;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @CurrentUser() actor: AuthUser, @ClientIp() ip: string) {
    const target = await this.users.findOne(id);
    if (target.role === 'ADMIN') {
      throw new BadRequestException('Admins cannot be deleted — change the role to User first');
    }
    this.control.forceLogout(id);
    const result = await this.users.remove(id, actor.id);
    await this.audit.record({
      action: 'USER_DELETE',
      actorId: actor.id,
      actorName: actor.username,
      targetType: 'USER',
      targetId: id,
      detail: `Deleted "${target.username}"`,
      ip,
    });
    return result;
  }
}

/** Human-readable summary of an UpdateUserDto for the audit trail (password masked). */
function summarizeChanges(dto: UpdateUserDto): string {
  const parts: string[] = [];
  if (dto.password !== undefined) parts.push('password reset');
  if (dto.role !== undefined) parts.push(`role→${dto.role}`);
  if (dto.active !== undefined) parts.push(dto.active ? 'enabled' : 'disabled');
  if (dto.locked !== undefined) parts.push(dto.locked ? 'locked' : 'unlocked');
  return parts.length ? parts.join(', ') : 'no changes';
}
