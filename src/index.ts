import { Hono } from 'hono';
import { ensureInitialDefaults } from './db';
import type { AppBindings, AppVariables } from './types';
import { authRoute } from './routes/auth';
import { syncRoute } from './routes/sync';
import { nodesRoute } from './routes/nodes';
import { templatesRoute } from './routes/templates';
import { usersRoute } from './routes/users';
import { subscriptionRoute } from './routes/subscription';

const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();

// Initialize defaults only on API routes (static assets bypass DB)
app.use('/api/*', async (c, next) => {
  await ensureInitialDefaults(c.env.DB);
  await next();
});

// Domain routes mount
app.route('', authRoute);
app.route('', syncRoute);
app.route('', nodesRoute);
app.route('', templatesRoute);
app.route('', usersRoute);
app.route('', subscriptionRoute);

// Fallback to static assets
app.get('*', async (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text('SM-UI Cloudflare Worker Master API is Running');
});

export default app;
