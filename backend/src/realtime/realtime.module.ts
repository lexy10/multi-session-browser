import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { ControlGateway } from './control.gateway';

@Module({
  imports: [ConfigModule, AuthModule], // AuthModule exports JwtModule
  providers: [ControlGateway],
  exports: [ControlGateway],
})
export class RealtimeModule {}
