import { Module } from '@nestjs/common';
import { ControlController } from './control.controller';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
  imports: [RealtimeModule],
  controllers: [ControlController],
})
export class ControlModule {}
