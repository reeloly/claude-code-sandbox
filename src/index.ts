import { getSandbox, proxyToSandbox } from "@cloudflare/sandbox";
import { clerkMiddleware } from "@hono/clerk-auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { getProjectR2Path } from "./constants";
import { messagesRoutes } from "./messages/messages.routes";
import { authMiddleware } from "./middleware/auth";
import { sandboxRoutes } from "./sandbox/sandbox.routes";

const EXTRA_SYSTEM =
  "You are an automatic feature-implementer/bug-fixer." +
  "You apply all necessary changes to achieve the user request. You must ensure you DO NOT commit the changes, " +
  "so the pipeline can read the local `git diff` and apply the change upstream.";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use(async (c, next) => {
  const { CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY } = c.env;
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
    origin: c.env.ALLOWED_ORIGINS,
    credentials: true,
  })(c, next);
});

app.route("/_messages", messagesRoutes);
app.route("/_sandbox", sandboxRoutes);

app.all("*", authMiddleware, async (c) => {
  const proxyResponse = await proxyToSandbox(c.req.raw, c.env);

  // If the sandbox proxy has a response, return it immediately
  if (proxyResponse) {
    return proxyResponse;
  }

  // hostname: 8080-{projectId}.reelolyproject.com
  const hostname = new URL(c.req.url).hostname;
  const projectId = hostname.split(".")[0].split("-").slice(1).join("-");

  // Validate projectId to prevent shell injection - only allow alphanumeric, hyphens, underscores
  if (!projectId || !/^[\w-]+$/.test(projectId)) {
    return c.json({ error: "Invalid project ID" }, 400);
  }

  // Validate userId to prevent shell injection (defense in depth)
  const userId = c.get("userId");
  if (!userId || !/^[\w-]+$/.test(userId)) {
    return c.json({ error: "Invalid user ID" }, 401);
  }

  const projectR2Path = getProjectR2Path(userId, projectId, c.env.ENVIRONMENT);
  const appDir = `/workspace/${projectId}/app`;
  const bundlePath = `/mnt/${projectR2Path}/repo.bundle`;

  const sandbox = getSandbox(c.env.Sandbox, projectId);

  try {
    await sandbox.setEnvVars({
      ANTHROPIC_API_KEY: c.env.ANTHROPIC_API_KEY,
    });
    const mountedFiles = await sandbox.exists("/mnt");
    if (!mountedFiles.exists) {
      await sandbox.mountBucket(c.env.REELLOLY_BUCKET_NAME, "/mnt", {
        endpoint: `https://${c.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: c.env.REELLOLY_BUCKET_ACCESS_KEY_ID,
          secretAccessKey: c.env.REELLOLY_BUCKET_SECRET_ACCESS_KEY,
        },
      });
    }
    await sandbox.startProcess(
      `/usr/local/bin/init.sh '${appDir}' '${bundlePath}'`
    );

    // Poll for server readiness (clone + install + dev server startup can take 30+ seconds)
    const maxAttempts = 60;
    const pollInterval = 1000;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
      const check = await sandbox.exec(
        "curl -s -o /dev/null -w '%{http_code}' http://localhost:8080 || echo '000'"
      );
      if (check.stdout.trim() !== "000") {
        break;
      }
    }

    const exposed = await sandbox.exposePort(8080, {
      hostname,
      name: "preview",
    });
    console.log("Server accessible at:", exposed.url);
    return c.json({ previewUrl: exposed.url }, 200);
  } catch (error) {
    console.error("Failed to initialize sandbox:", error);
    return c.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to initialize sandbox",
      },
      500
    );
  }
});

// export default {
//   async fetch(request: Request, env: CloudflareBindings): Promise<Response> {
//     if (request.method === "POST") {
//       try {
//         const { repo, task } = await request.json<{
//           repo?: string;
//           task?: string;
//         }>();
//         if (!repo || !task)
//           return new Response("invalid body", { status: 400 });

//         // get the repo name
//         const name = repo.split("/").pop() ?? "tmp";

//         // open sandbox
//         const sandbox = getSandbox(
//           env.Sandbox,
//           crypto.randomUUID().slice(0, 8)
//         );

//         // git clone repo
//         await sandbox.gitCheckout(repo, { targetDir: name });

//         const { ANTHROPIC_API_KEY } = env;

//         // Set env vars for the session
//         await sandbox.setEnvVars({ ANTHROPIC_API_KEY });

//         // kick off CC with our query
//         const cmd = `cd ${name} && claude --append-system-prompt "${EXTRA_SYSTEM}" -p "${task.replaceAll(
//           '"',
//           '\\"'
//         )}" --permission-mode acceptEdits`;

//         const logs = getOutput(await sandbox.exec(cmd));
//         const diff = getOutput(await sandbox.exec("git diff"));
//         return Response.json({ logs, diff });
//       } catch {
//         return new Response("invalid body", { status: 400 });
//       }
//     }
//     return new Response("not found");
//   },
// };

export default app;
export { Sandbox } from "@cloudflare/sandbox";
