import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ClientIp } from '../common/client-ip.decorator';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private prisma: PrismaService, private audit: AuditService) {}

  // Throttle brute-force / credential-stuffing: max 5 attempts per minute per IP.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @UseGuards(ThrottlerGuard)
  @Post('login')
  async login(@Body() dto: LoginDto, @ClientIp() ip: string) {
    try {
      const result = await this.auth.login(dto.username, dto.password);
      await this.audit.record({
        action: 'LOGIN_SUCCESS',
        actorId: result.user.id,
        actorName: result.user.username,
        ip,
      });
      return result;
    } catch (e) {
      await this.audit.record({
        action: 'LOGIN_FAILURE',
        actorName: dto.username,
        detail: 'Invalid credentials or inactive account',
        ip,
      });
      throw e;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const fresh = await this.prisma.user.findUnique({ where: { id: user.id } });
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      locked: fresh?.locked ?? false,
    };
  }
}
