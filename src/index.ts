import { proxyToSandbox } from "@cloudflare/sandbox";
import { clerkMiddleware } from "@hono/clerk-auth";
import { Hono } from "hono";
import { cors } from "hono/cors";
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
    console.log("service is warm, returning proxy response");
    return proxyResponse;
  }

  console.log("service is not warm, initializing sandbox");
  return c.json({ error: "Sandbox is not running" }, 500);
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
export { SandboxLock } from "./durable-objects/sandbox-lock";
