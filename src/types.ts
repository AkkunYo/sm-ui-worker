import type { Context } from 'hono';
import type { Env } from './db';

export interface JwtUser {
  userId: number;
  username: string;
  role: 'admin' | 'user';
}

export type AppVariables = {
  user: JwtUser;
};

export type AppBindings = Env;

export type AppContext = Context<{ Bindings: AppBindings; Variables: AppVariables }>;
