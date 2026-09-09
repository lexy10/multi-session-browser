import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { ControlGateway } from '../realtime/control.gateway';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private settings: SettingsService, private control: ControlGateway) {}

  /** Any authenticated client (the browser) fetches the config it needs to run. */
  @Get('effective')
  effective() {
    return this.settings.getForClient();
  }

  /** Admin-only display of current settings (no raw password). */
  @Get()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  get() {
    return this.settings.getForAdmin();
  }

  @Put()
  @UseGuards(RolesGuard)
  @Roles(Role.ADMIN)
  async update(@Body() dto: UpdateSettingsDto) {
    const view = await this.settings.update(dto);
    // Push the new config to all live clients, and apply a global lock toggle.
    const clientConfig = await this.settings.getForClient();
    this.control.settingsUpdated(clientConfig);
    if (dto.globalLock === true) this.control.lockAll();
    if (dto.globalLock === false) this.control.unlockAll();
    return view;
  }
}
