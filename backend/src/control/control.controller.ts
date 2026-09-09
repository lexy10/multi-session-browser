import { BadRequestException, Controller, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { ControlGateway } from '../realtime/control.gateway';

@Controller('control')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class ControlController {
  constructor(private prisma: PrismaService, private control: ControlGateway) {}

  @Post('lock/:userId')
  async lock(@Param('userId') userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === 'ADMIN') throw new BadRequestException('Admins cannot be locked');
    await this.prisma.user.update({ where: { id: userId }, data: { locked: true } });
    this.control.lockUser(userId);
    return { ok: true };
  }

  @Post('unlock/:userId')
  async unlock(@Param('userId') userId: string) {
    await this.prisma.user.update({ where: { id: userId }, data: { locked: false } });
    this.control.unlockUser(userId);
    return { ok: true };
  }

  @Post('lock-all')
  async lockAll() {
    await this.prisma.appSetting.update({ where: { id: 1 }, data: { globalLock: true } });
    this.control.lockAll();
    return { ok: true };
  }

  @Post('unlock-all')
  async unlockAll() {
    await this.prisma.appSetting.update({ where: { id: 1 }, data: { globalLock: false } });
    this.control.unlockAll();
    return { ok: true };
  }

  @Post('logout/:userId')
  logout(@Param('userId') userId: string) {
    this.control.forceLogout(userId);
    return { ok: true };
  }
}
