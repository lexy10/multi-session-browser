import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/roles.decorator';
import { CurrentUser, AuthUser } from '../common/current-user.decorator';
import { ClientIp } from '../common/client-ip.decorator';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { ControlGateway } from '../realtime/control.gateway';
import { AuditService } from '../audit/audit.service';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(
    private settings: SettingsService,
    private control: ControlGateway,
    private audit: AuditService,
  ) {}

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
  async update(@Body() dto: UpdateSettingsDto, @CurrentUser() actor: AuthUser, @ClientIp() ip: string) {
    const view = await this.settings.update(dto);
    // Push the new config to all live clients, and apply a global lock toggle.
    const clientConfig = await this.settings.getForClient();
    this.control.settingsUpdated(clientConfig);
    if (dto.globalLock === true) this.control.lockAll();
    if (dto.globalLock === false) this.control.unlockAll();
    await this.audit.record({
      action: 'SETTINGS_UPDATE',
      actorId: actor.id,
      actorName: actor.username,
      targetType: 'SETTINGS',
      detail: summarizeSettings(dto),
      ip,
    });
    return view;
  }
}

/** Human-readable summary of a settings change for the audit trail (secret masked). */
function summarizeSettings(dto: UpdateSettingsDto): string {
  const parts: string[] = [];
  if (dto.decodoUsername !== undefined) parts.push(`username="${dto.decodoUsername}"`);
  if (dto.decodoPassword) parts.push('password changed');
  if (dto.endpoint !== undefined) parts.push(`endpoint=${dto.endpoint}`);
  if (dto.sessionDuration !== undefined) parts.push(`session=${dto.sessionDuration}m`);
  if (dto.dataSaver !== undefined) parts.push(`dataSaver=${dto.dataSaver}`);
  if (dto.autoCountry !== undefined) parts.push(`country=${dto.autoCountry || 'default'}`);
  if (dto.autoCity !== undefined) parts.push(`city=${dto.autoCity || 'default'}`);
  if (dto.globalLock !== undefined) parts.push(dto.globalLock ? 'global lock ON' : 'global lock OFF');
  return parts.length ? parts.join(', ') : 'no changes';
}
