import { createMiddleware } from "hono/factory";

export const requireWorkspace = createMiddleware(async (_c, next) => {
  await next();
});

