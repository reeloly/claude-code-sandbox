import { proxyToSandbox } from "@cloudflare/sandbox";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
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
