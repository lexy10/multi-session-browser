import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { HistoryService } from './history.service';
import { RecordHistoryDto } from './dto/record.dto';

@Controller('history')
@UseGuards(JwtAuthGuard)
export class HistoryController {
  constructor(private history: HistoryService) {}

  // record a visit for the current user
  @Post()
  record(@CurrentUser() user: AuthUser, @Body() dto: RecordHistoryDto) {
    return this.history.record(user.id, dto.url, dto.title || '');
  }

  // the current user's own (active) history
  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @Query('page') page?: string, @Query('limit') limit?: string, @Query('q') q?: string) {
    return this.history.listMine(user.id, { page: parseInt(page || '1', 10), limit: parseInt(limit || '50', 10), q: q || '' });
  }

  // soft-clear all of the current user's history
  @Delete('mine')
  async clearMine(@CurrentUser() user: AuthUser) {
    const r = await this.history.clearMine(user.id);
    return { ok: true, cleared: r.count };
  }

  // soft-delete one of the current user's entries
  @Delete('mine/:id')
  async deleteMine(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const r = await this.history.softDeleteMine(user.id, id);
    return { ok: r.count > 0 };
  }

  // admin: any user's full history (including soft-deleted)
  @Get('user/:userId')
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  forUser(@Param('userId') userId: string, @Query('page') page?: string, @Query('limit') limit?: string, @Query('q') q?: string) {
    return this.history.listForUser(userId, { page: parseInt(page || '1', 10), limit: parseInt(limit || '50', 10), q: q || '' });
  }
}
