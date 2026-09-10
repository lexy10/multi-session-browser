import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './crypto/crypto.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { SettingsModule } from './settings/settings.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ControlModule } from './control/control.module';
import { HistoryModule } from './history/history.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Rate-limit config; the login route opts in via ThrottlerGuard (see AuthController).
    // High-frequency client calls (history/settings) are deliberately NOT throttled.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 60 }]),
    PrismaModule,
    CryptoModule,
    AuditModule,
    AuthModule,
    UsersModule,
    SettingsModule,
    RealtimeModule,
    ControlModule,
    HistoryModule,
  ],
})
export class AppModule {}
