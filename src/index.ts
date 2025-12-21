import { clerkMiddleware } from "@hono/clerk-auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { env } from "./env-helper";
import { messagesRoutes } from "./messages/messages.routes";
import { sandboxRoutes } from "./sandbox/sandbox.routes";

const app = new Hono();

app.use(async (c, next) => {
  const { CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY } = env;
  if (!CLERK_PUBLISHABLE_KEY || !CLERK_SECRET_KEY) {
    return c.json(
      { error: "CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY are required" },
      500
    );
  }
  return clerkMiddleware({
    publishableKey: CLERK_PUBLISHABLE_KEY,
    secretKey: CLERK_SECRET_KEY,
  })(c, next);
});

app.use(async (c, next) => {
  return cors({
    origin: env.ALLOWED_ORIGINS,
    credentials: true,
  })(c, next);
});

app.route("/_messages", messagesRoutes);
app.route("/_sandbox", sandboxRoutes);

app.get("/", (c) => {
  return c.json({ message: "Hello, world!" });
});

export default app;
