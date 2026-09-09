import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const publicSelect = {
  id: true,
  username: true,
  role: true,
  active: true,
  locked: true,
  createdAt: true,
  updatedAt: true,
};

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findAll({ page = 1, limit = 25, q = '' } = {}) {
    const take = Math.min(Math.max(Number(limit) || 25, 1), 100);
    const p = Math.max(Number(page) || 1, 1);
    const where = q ? { username: { contains: q, mode: 'insensitive' as const } } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, select: publicSelect, orderBy: { createdAt: 'asc' }, skip: (p - 1) * take, take }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page: p, limit: take, pages: Math.max(Math.ceil(total / take), 1) };
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: publicSelect });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(dto: CreateUserDto) {
    const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (exists) throw new BadRequestException('Username already taken');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    return this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash,
        role: dto.role ?? Role.USER,
        active: dto.active ?? true,
      },
      select: publicSelect,
    });
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);
    const data: any = {};
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 12);
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.locked !== undefined) data.locked = dto.locked;
    return this.prisma.user.update({ where: { id }, data, select: publicSelect });
  }

  async remove(id: string, actingUserId: string) {
    if (id === actingUserId) throw new BadRequestException('You cannot delete your own account');
    await this.findOne(id);
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}
