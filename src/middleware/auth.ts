import { verify } from 'hono/jwt';
import { getJwtSecret } from '../db';
import type { AppContext, JwtUser } from '../types';

export const authMiddleware = async (c: AppContext, next: any) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const token = authHeader.substring(7);
  const secret = await getJwtSecret(c.env.DB);
  try {
    const payload = (await verify(token, secret, 'HS256')) as unknown as JwtUser;
    const liveUser = await c.env.DB.prepare('SELECT id, username, role, status FROM users WHERE id = ?').bind(payload.userId).first<any>();
    if (!liveUser || liveUser.status !== 1) {
      return c.json({ error: '用户不存在或已被禁用' }, 401);
    }
    c.set('user', { userId: liveUser.id, username: liveUser.username, role: liveUser.role });
    await next();
  } catch (e) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }
};

export const adminOnly = async (c: AppContext, next: any) => {
  const user = c.get('user');
  if (user?.role !== 'admin') {
    return c.json({ error: 'Forbidden: 管理员专属操作' }, 403);
  }
  await next();
};
