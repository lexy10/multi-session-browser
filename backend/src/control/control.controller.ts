import { BadRequestException, Controller, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ClientIp } from '../common/client-ip.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ControlGateway } from '../realtime/control.gateway';
import { AuditService } from '../audit/audit.service';

@Controller('control')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ControlController {
  constructor(
    private prisma: PrismaService,
    private control: ControlGateway,
    private audit: AuditService,
  ) {}

  @Post('lock/:userId')
  async lock(@Param('userId') userId: string, @CurrentUser() actor: AuthUser, @ClientIp() ip: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'ADMIN') throw new BadRequestException('Admins cannot be locked');
    await this.prisma.user.update({ where: { id: userId }, data: { locked: true } });
    this.control.lockUser(userId);
    await this.audit.record({
      action: 'LOCK', actorId: actor.id, actorName: actor.username,
      targetType: 'USER', targetId: userId, detail: `Locked "${user.username}"`, ip,
    });
    return { ok: true };
  }

  @Post('unlock/:userId')
  async unlock(@Param('userId') userId: string, @CurrentUser() actor: AuthUser, @ClientIp() ip: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    await this.prisma.user.update({ where: { id: userId }, data: { locked: false } });
    this.control.unlockUser(userId);
    await this.audit.record({
      action: 'UNLOCK', actorId: actor.id, actorName: actor.username,
      targetType: 'USER', targetId: userId, detail: `Unlocked "${user?.username ?? userId}"`, ip,
    });
    return { ok: true };
  }

  @Post('lock-all')
  async lockAll(@CurrentUser() actor: AuthUser, @ClientIp() ip: string) {
    await this.prisma.appSetting.update({ where: { id: 1 }, data: { globalLock: true } });
    this.control.lockAll();
    await this.audit.record({
      action: 'LOCK_ALL', actorId: actor.id, actorName: actor.username,
      targetType: 'CLIENTS', detail: 'Locked all non-admin clients', ip,
    });
    return { ok: true };
  }

  @Post('unlock-all')
  async unlockAll(@CurrentUser() actor: AuthUser, @ClientIp() ip: string) {
    await this.prisma.appSetting.update({ where: { id: 1 }, data: { globalLock: false } });
    this.control.unlockAll();
    await this.audit.record({
      action: 'UNLOCK_ALL', actorId: actor.id, actorName: actor.username,
      targetType: 'CLIENTS', detail: 'Unlocked all clients', ip,
    });
    return { ok: true };
  }

  @Post('logout/:userId')
  async logout(@Param('userId') userId: string, @CurrentUser() actor: AuthUser, @ClientIp() ip: string) {
    this.control.forceLogout(userId);
    await this.audit.record({
      action: 'FORCE_LOGOUT', actorId: actor.id, actorName: actor.username,
      targetType: 'USER', targetId: userId, detail: 'Forced logout', ip,
    });
    return { ok: true };
  }
}
