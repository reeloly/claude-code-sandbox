import { getSandbox, proxyToSandbox } from "@cloudflare/sandbox";
import { Hono } from "hono";
import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import z from "zod";
import { getProjectR2Path } from "@/constants";
import { authMiddleware } from "@/middleware/auth";

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

sandboxRoutes.post("/init", authMiddleware, validator, async (c) => {
  // TODO: use DO to control concurrency of sandbox init
  const { projectId } = c.req.valid("json");
  const userId = c.get("userId");
  const sandbox = getSandbox(c.env.Sandbox, projectId);

  const projectR2Path = getProjectR2Path(userId, projectId, c.env.ENVIRONMENT);

  // Use JSON.stringify to safely escape user input for shell commands (consistent with messages.service.ts)
  const appDir = JSON.stringify(`/workspace/${projectId}/app`);
  const bundlePath = JSON.stringify(`/mnt/${projectR2Path}/repo.bundle`);

  await sandbox.setEnvVars({
    ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY,
  });

  await sandbox.mountBucket(c.env.REELLOLY_BUCKET_NAME, "/mnt", {
    endpoint: `https://${c.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: c.env.REELLOLY_BUCKET_ACCESS_KEY_ID,
      secretAccessKey: c.env.REELLOLY_BUCKET_SECRET_ACCESS_KEY,
    },
  });

  const cloneResult = await sandbox.exec(
    `rm -rf ${appDir} \
    && mkdir -p ${appDir} \
    && cd ${appDir} \
    && git clone ${bundlePath} .`
  );

  if (!cloneResult.success) {
    console.error({
      message: "Failed to clone project",
      stdout: cloneResult.stdout,
      stderr: cloneResult.stderr,
    });
    return c.json(
      {
        message: "Failed to clone project",
        stdout: cloneResult.stdout,
        stderr: cloneResult.stderr,
      },
      500
    );
  }

  const installResult = await sandbox.exec(`cd ${appDir} && bun install`);

  if (!installResult.success) {
    console.error({
      message: "Failed to install project dependencies",
      stdout: installResult.stdout,
      stderr: installResult.stderr,
    });
    return c.json(
      {
        message: "Failed to install project dependencies",
        stdout: installResult.stdout,
        stderr: installResult.stderr,
      },
      500
    );
  }

  try {
    await sandbox.startProcess(`cd ${appDir} && bun run dev`);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const { hostname } = new URL(c.req.url);
    const exposed = await sandbox.exposePort(8080, {
      hostname,
      name: "preview",
    });
    console.log("Server accessible at:", exposed.url);

    return c.json({
      message: "Port exposed",
      previewUrl: exposed.url,
    });
  } catch (error) {
    console.error({
      message: "Failed to start development server",
      error,
    });
    return c.json(
      {
        message: "Failed to start development server",
        error: error instanceof Error ? error.message : String(error),
      },
      500
    );
  }
});
