import { getSandbox, proxyToSandbox } from "@cloudflare/sandbox";
import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import z from "zod";

export const sandboxRoutes = new Hono<{ Bindings: CloudflareBindings }>();

sandboxRoutes.get("/status", async (c) => {
  const proxyResponse = await proxyToSandbox(c.req.raw, c.env);

  if (proxyResponse) {
    return c.json({ message: "Sandbox is running" });
  }
  return c.json({ message: "Sandbox is not running" });
});

const validator = zValidator(
  "json",
  z.object({
    projectId: z.string(),
  }),
  (result, c) => {
    if (!result.success) {
      console.error({
        message: "Invalid request body",
        error: result.error,
      });
      return c.json({ error: result.error }, 400);
    }
  }
);

sandboxRoutes.post("/init", validator, async (c) => {
  const { projectId } = c.req.valid("json");
  const sandbox = getSandbox(c.env.Sandbox, projectId);
  sandbox.exposePort(8080, { hostname: "localhost", name: "http" });
  return c.json({
    message: "Port exposed",
  });
});
