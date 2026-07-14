import { createMiddleware } from "hono/factory";

export const rateLimit = createMiddleware(async (_c, next) => {
  await next();
});

