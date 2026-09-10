import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  action: string;
  actorId?: string | null;
  actorName?: string;
  targetType?: string | null;
  targetId?: string | null;
  detail?: string;
  ip?: string;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private prisma: PrismaService) {}

  /**
   * Record a security-relevant event. Never throws — auditing must not break the
   * request it is auditing; a write failure is logged and swallowed.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          action: entry.action,
          actorId: entry.actorId ?? null,
          actorName: entry.actorName ?? '',
          targetType: entry.targetType ?? null,
          targetId: entry.targetId ?? null,
          detail: entry.detail ?? '',
          ip: entry.ip ?? '',
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to write audit log (${entry.action}): ${(e as Error).message}`);
    }
  }

  /** Paginated, newest-first list for the admin console. */
  async list({ page = 1, limit = 50, action = '', q = '' }: { page?: number; limit?: number; action?: string; q?: string }) {
    const take = Math.min(Math.max(limit, 1), 200);
    const skip = (Math.max(page, 1) - 1) * take;
    const where: any = {};
    if (action) where.action = action;
    if (q) {
      where.OR = [
        { actorName: { contains: q, mode: 'insensitive' } },
        { detail: { contains: q, mode: 'insensitive' } },
        { ip: { contains: q, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items, total, page: Math.max(page, 1), pages: Math.max(Math.ceil(total / take), 1) };
  }
}
