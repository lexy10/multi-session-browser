import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * AES-256-GCM encryption for secrets at rest (the Decodo password).
 * Key comes from SETTINGS_ENC_KEY (32 bytes, hex or base64).
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const raw = config.get<string>('SETTINGS_ENC_KEY') || '';
    let key: Buffer;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, 'hex');
    else key = Buffer.from(raw, 'base64');
    if (key.length !== 32) {
      this.logger.warn('SETTINGS_ENC_KEY is not 32 bytes; deriving one via SHA-256 (set a proper key!).');
      key = crypto.createHash('sha256').update(raw).digest();
    }
    this.key = key;
  }

  encrypt(plain: string): string {
    if (!plain) return '';
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
  }

  decrypt(payload: string): string {
    if (!payload) return '';
    try {
      const [ivB64, tagB64, dataB64] = payload.split(':');
      const iv = Buffer.from(ivB64, 'base64');
      const tag = Buffer.from(tagB64, 'base64');
      const data = Buffer.from(dataB64, 'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    } catch (e) {
      this.logger.error('Failed to decrypt a secret (wrong SETTINGS_ENC_KEY?).');
      return '';
    }
  }
}
