import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const sel = { id: true, url: true, title: true, visitedAt: true, deletedAt: true };

@Injectable()
export class HistoryService {
  constructor(private prisma: PrismaService) {}

  record(userId: string, url: string, title: string) {
    if (!url) return null;
    return this.prisma.history.create({
      data: { userId, url: url.slice(0, 4000), title: (title || '').slice(0, 600) },
    });
  }

  private paginate(page: number, limit: number) {
    const take = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const p = Math.max(Number(page) || 1, 1);
    return { take, p, skip: (p - 1) * take };
  }

  private searchWhere(q: string) {
    if (!q) return {};
    return {
      OR: [
        { url: { contains: q, mode: 'insensitive' as const } },
        { title: { contains: q, mode: 'insensitive' as const } },
      ],
    };
  }

  /** A user's own history — active entries only. */
  async listMine(userId: string, { page = 1, limit = 50, q = '' } = {}) {
    const { take, p, skip } = this.paginate(page, limit);
    const where = { userId, deletedAt: null, ...this.searchWhere(q) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.history.findMany({ where, select: sel, orderBy: { visitedAt: 'desc' }, skip, take }),
      this.prisma.history.count({ where }),
    ]);
    return { items, total, page: p, limit: take, pages: Math.max(Math.ceil(total / take), 1) };
  }

  softDeleteMine(userId: string, id: string) {
    return this.prisma.history.updateMany({
      where: { id, userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  clearMine(userId: string) {
    return this.prisma.history.updateMany({
      where: { userId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
  }

  /** Admin view of any user's history — includes soft-deleted entries. */
  async listForUser(userId: string, { page = 1, limit = 50, q = '' } = {}) {
    const { take, p, skip } = this.paginate(page, limit);
    const where = { userId, ...this.searchWhere(q) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.history.findMany({ where, select: sel, orderBy: { visitedAt: 'desc' }, skip, take }),
      this.prisma.history.count({ where }),
    ]);
    return { items, total, page: p, limit: take, pages: Math.max(Math.ceil(total / take), 1) };
  }
}
