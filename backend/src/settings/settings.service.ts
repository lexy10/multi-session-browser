import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService, private crypto: CryptoService) {}

  private async row() {
    return this.prisma.appSetting.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
  }

  /** Full config the browser needs to configure proxying (includes decrypted password). */
  async getForClient() {
    const s = await this.row();
    return {
      endpoint: s.endpoint,
      username: s.decodoUsername,
      password: this.crypto.decrypt(s.decodoPasswordEnc),
      sessionDuration: s.sessionDuration,
      dataSaver: s.dataSaver,
      autoCountry: s.autoCountry,
      autoCity: s.autoCity,
      globalLock: s.globalLock,
    };
  }

  /** Admin display view — never returns the raw password. */
  async getForAdmin() {
    const s = await this.row();
    return {
      endpoint: s.endpoint,
      username: s.decodoUsername,
      hasPassword: Boolean(s.decodoPasswordEnc),
      sessionDuration: s.sessionDuration,
      dataSaver: s.dataSaver,
      autoCountry: s.autoCountry,
      autoCity: s.autoCity,
      globalLock: s.globalLock,
      updatedAt: s.updatedAt,
    };
  }

  async update(dto: UpdateSettingsDto) {
    await this.row();
    const data: any = {};
    if (dto.decodoUsername !== undefined) data.decodoUsername = dto.decodoUsername.trim();
    if (dto.decodoPassword) data.decodoPasswordEnc = this.crypto.encrypt(dto.decodoPassword);
    if (dto.endpoint !== undefined) data.endpoint = dto.endpoint.trim();
    if (dto.sessionDuration !== undefined) data.sessionDuration = dto.sessionDuration;
    if (dto.dataSaver !== undefined) data.dataSaver = dto.dataSaver;
    if (dto.autoCountry !== undefined) data.autoCountry = dto.autoCountry.trim().toLowerCase();
    if (dto.autoCity !== undefined) data.autoCity = dto.autoCity.trim().toLowerCase();
    if (dto.globalLock !== undefined) data.globalLock = dto.globalLock;
    await this.prisma.appSetting.update({ where: { id: 1 }, data });
    return this.getForAdmin();
  }
}
