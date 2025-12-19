import { getSandbox, proxyToSandbox } from "@cloudflare/sandbox";
import { Hono } from "hono";
import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import z from "zod";

export const sandboxRoutes = new Hono<{ Bindings: CloudflareBindings }>();

const statusResponseSchema = z.object({
  isWarm: z.boolean(),
  previewUrl: z.string().optional(),
  error: z.string().optional(),
});

sandboxRoutes.get(
  "/status",
  describeRoute({
    responses: {
      200: {
        description: "Sandbox status",
        content: {
          "application/json": {
            schema: resolver(statusResponseSchema),
          },
        },
      },
    },
  }),
  async (c) => {
    const proxyResponse = await proxyToSandbox(c.req.raw, c.env);

    if (proxyResponse) {
      const response = { isWarm: true, previewUrl: proxyResponse.url };
      statusResponseSchema.parse(response);
      return c.json(response, 200);
    }
    const response = { isWarm: false, error: "Sandbox is not running" };
    statusResponseSchema.parse(response);
    return c.json(response, 200);
  }
);

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
