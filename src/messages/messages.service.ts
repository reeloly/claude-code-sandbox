import {
  type ExecEvent,
  getSandbox,
  parseSSEStream,
} from "@cloudflare/sandbox";
import {
  BUNDLE_FILE_KEY,
  getProjectR2Path,
  TEMPLATE_BUNDLE_FILE_KEY,
} from "@/constants";
import { getOutput } from "@/utils";
import type { SseEventSender } from "./messages.utils";

export async function createMessage({
  userId,
  message,
  projectId,
  sender,
  env,
}: {
  userId: string;
  message: string;
  projectId: string;
  sender: SseEventSender;
  env: CloudflareBindings;
}): Promise<void> {
  // open sandbox
  const sandbox = getSandbox(env.Sandbox, crypto.randomUUID().slice(0, 8));

  const { ANTHROPIC_API_KEY } = env;

  // Set env vars for the session
  await sandbox.setEnvVars({ ANTHROPIC_API_KEY });

  // mount the R2 bucket to sandbox
  await sandbox.mountBucket(env.REELLOLY_BUCKET_NAME, "/mounted", {
    endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.REELLOLY_BUCKET_ACCESS_KEY_ID,
      secretAccessKey: env.REELLOLY_BUCKET_SECRET_ACCESS_KEY,
    },
  });
  console.log("Mounted R2 bucket to sandbox");
  // ensure the bundle for the project exists in R2 bucket
  const projectR2Path = getProjectR2Path(userId, projectId, env.ENVIRONMENT);
  const projectBundleExists = await env.REELLOLY_BUCKET.head(
    `${projectR2Path}/${BUNDLE_FILE_KEY}`
  );
  if (!projectBundleExists) {
    console.log("Project bundle does not exist, copying template bundle");
    // copy the template bundle to the project directory
    const templateBundle = await env.REELLOLY_BUCKET.get(
      TEMPLATE_BUNDLE_FILE_KEY
    );
    if (!templateBundle) {
      console.error("Template bundle does not exist");
      return;
    }
    await env.REELLOLY_BUCKET.put(
      `${projectR2Path}/${BUNDLE_FILE_KEY}`,
      templateBundle.body
    );
  }
  console.log("Ensured project bundle exists");
  // copy code to sandbox local filesystem
  const copyCodeOutput = await sandbox.exec(`
    set -euo pipefail
  
    PROJECT_ID=${JSON.stringify(projectId)}
    R2_PATH=${JSON.stringify(projectR2Path)}
    BUNDLE=${JSON.stringify(BUNDLE_FILE_KEY)}
  
    ROOT="/sandbox/$PROJECT_ID"
    BUNDLE_PATH="$ROOT/$BUNDLE"
    REPO="$ROOT/project"
  
    mkdir -p "$ROOT"
    cp "/mounted/$R2_PATH/$BUNDLE" "$BUNDLE_PATH"
  
    # optional sanity check (recommended)
    git bundle verify "$BUNDLE_PATH" >/dev/null
  
    if [ -d "$REPO/.git" ]; then
      cd "$REPO"
      # Update repo from the bundle
      git fetch "$BUNDLE_PATH" 'refs/heads/*:refs/remotes/bundle/*'
      # Force working tree to match bundle's main
      git switch -C main bundle/main
      git reset --hard bundle/main
      git clean -fd
    else
      rm -rf "$REPO"
      git clone "$BUNDLE_PATH" "$REPO"
      cd "$REPO"
      git switch -C main || git checkout -B main
    fi
  `);
  console.log("Copy code output:", getOutput(copyCodeOutput));
  console.log("Checked out project code");

  // checkout the agent code to sandbox local filesystem
  await sandbox.gitCheckout(env.AGENT_REPO_URL, { targetDir: "agent" });
  await sandbox.exec(`cd agent && bun install`);
  // run agent with cwd set to the project directory and stream the response back to the client
  // Use shell variables with JSON.stringify to safely escape user input and prevent shell injection
  const stream = await sandbox.execStream(
    `MESSAGE=${JSON.stringify(message)} PROJECT_ID=${JSON.stringify(
      projectId
    )} && cd agent && bun run start "$MESSAGE" --cwd /sandbox/"$PROJECT_ID"/project`
  );
  for await (const event of parseSSEStream<ExecEvent>(stream)) {
    switch (event.type) {
      case "stdout":
        console.log(event.data);
        await sender.sendEvent({
          id: crypto.randomUUID(),
          message: {
            type: "agent.message.delta",
            delta: event.data ?? "",
          },
        });
        break;

      case "stderr":
        console.error(event.data);
        break;

      case "complete":
        console.log("Exit code:", event.exitCode);
        break;

      case "error":
        console.error("Failed:", event.error);
        break;
    }
  }
  // TODO: when agent is done, if code is changed, create a git bundle and copy the bundle to mounted directory
  // TODO: when agent is done, if code is changed, build the project and copy the build output to R2 for preview

  await sender.sendEvent({
    id: crypto.randomUUID(),
    message: {
      type: "agent.message.end",
    },
  });
}
