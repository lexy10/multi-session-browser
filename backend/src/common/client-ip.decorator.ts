import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Best-effort client IP. Behind Cloudflare + Caddy the socket address is a proxy,
 * so prefer the forwarded headers, then fall back to Express's req.ip.
 */
export const ClientIp = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest();
    const cf = req.headers?.['cf-connecting-ip'];
    if (typeof cf === 'string' && cf) return cf;
    const xff = req.headers?.['x-forwarded-for'];
    if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
    return req.ip || '';
  },
);
