import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AppEnv } from './env';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/**
 * /api/shortcut/* はショートカット用のトークンで、それ以外は Cloudflare Access の JWT で認証する。
 * Access 側では /api/shortcut/ だけ Bypass にしておく（docs/SETUP.md）
 */
export const auth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const env = c.env;
  if (env.AUTH_MODE === 'none') return next();

  if (new URL(c.req.url).pathname.startsWith('/api/shortcut/')) {
    const header = c.req.header('authorization') ?? '';
    const token = header.replace(/^Bearer\s+/i, '');
    if (!env.API_TOKEN || !token || !timingSafeEqual(token, env.API_TOKEN)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return next();
  }

  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    return c.json({ error: 'Cloudflare Access が設定されていません（docs/SETUP.md）' }, 500);
  }
  const jwt = c.req.header('cf-access-jwt-assertion');
  if (!jwt) return c.json({ error: 'unauthorized' }, 401);
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}.cloudflareaccess.com`;
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    jwksCache.set(issuer, jwks);
  }
  try {
    await jwtVerify(jwt, jwks, { issuer, audience: env.ACCESS_AUD });
  } catch {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
};
