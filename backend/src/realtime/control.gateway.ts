import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Realtime control channel. Browser clients connect with their JWT; the server
 * pushes commands to a specific user (`user:<id>`), a role, or everyone (`all`).
 */
@WebSocketGateway({ namespace: '/control', cors: { origin: '*' } })
export class ControlGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ControlGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private jwt: JwtService,
    private config: ConfigService,
    private prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        (client.handshake.auth && (client.handshake.auth as any).token) ||
        (client.handshake.query && (client.handshake.query.token as string));
      if (!token) throw new Error('missing token');
      const payload: any = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>('JWT_SECRET') || 'dev-secret',
      });
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (!user || !user.active) throw new Error('inactive');

      (client.data as any).user = { id: user.id, username: user.username, role: user.role };
      client.join(`user:${user.id}`);
      client.join(`role:${user.role}`);
      client.join('all');
      this.logger.log(`connected: ${user.username} (${user.role})`);

      // Tell the client its current lock state right away. Admins are never
      // caught by a global lock (so an admin can't lock themselves out).
      const settings = await this.prisma.appSetting.findUnique({ where: { id: 1 } });
      if (user.role === 'USER' && (user.locked || settings?.globalLock)) {
        client.emit('lock', { reason: user.locked ? 'account' : 'global' });
      }
    } catch (e) {
      client.emit('unauthorized', { message: 'Invalid or missing token' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket) {
    const u = (client.data as any)?.user;
    if (u) this.logger.log(`disconnected: ${u.username}`);
  }

  // ---- Server -> client commands ------------------------------------------

  lockUser(userId: string, reason = 'account') {
    this.server.to(`user:${userId}`).emit('lock', { reason });
  }

  unlockUser(userId: string) {
    this.server.to(`user:${userId}`).emit('unlock', {});
  }

  // Global lock targets USER-role clients only — admins keep control.
  lockAll(reason = 'global') {
    this.server.to('role:USER').emit('lock', { reason });
  }

  unlockAll() {
    this.server.to('role:USER').emit('unlock', {});
  }

  forceLogout(userId: string) {
    this.server.to(`user:${userId}`).emit('logout', {});
  }

  /** Notify clients that central settings changed so they re-fetch/apply them. */
  settingsUpdated(config: any, userId?: string) {
    const target = userId ? this.server.to(`user:${userId}`) : this.server.to('all');
    target.emit('settings:updated', config);
  }
}
