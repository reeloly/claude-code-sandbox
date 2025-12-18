import {
  type ExecEvent,
  getSandbox,
  parseSSEStream,
  type Sandbox,
} from "@cloudflare/sandbox";
import {
  BUNDLE_FILE_KEY,
  getProjectR2Path,
  TEMPLATE_BUNDLE_FILE_KEY,
} from "@/constants";
import { getOutput } from "@/utils";
import type { SseEventSender } from "./messages.utils";

async function copyCodeToSandbox(
  sandbox: Sandbox,
  projectId: string,
  projectR2Path: string
): Promise<void> {
  const rootDir = `/sandbox/${projectId}`;
  const bundlePath = `${rootDir}/${BUNDLE_FILE_KEY}`;
  const repoDir = `${rootDir}/project`;
  const mountedBundlePath = `/mounted/${projectR2Path}/${BUNDLE_FILE_KEY}`;

  // Step 1: Create root directory
  console.log(`Creating root directory: ${rootDir}`);
  const mkdirResult = await sandbox.mkdir(JSON.stringify(rootDir), {
    recursive: true,
  });
  console.log({ mkdirResult });

  // Step 2: Copy bundle from mounted R2 to sandbox
  console.log(`Copying bundle from ${mountedBundlePath} to ${bundlePath}`);
  await sandbox.mkdir(JSON.stringify(bundlePath), {
    recursive: true,
  });
  const cpResult = await sandbox.exec(
    `cp ${JSON.stringify(mountedBundlePath)} ${JSON.stringify(bundlePath)}`
  );
  console.log("cp output:", getOutput(cpResult));

  // Step 3: Verify git bundle
  console.log(`Verifying git bundle: ${bundlePath}`);
  const verifyResult = await sandbox.exec(
    `git bundle verify ${JSON.stringify(bundlePath)}`
  );
  console.log("git bundle verify output:", getOutput(verifyResult));

  // Step 4: Check if repo already exists
  console.log(`Checking if repo exists: ${repoDir}`);
  const checkRepoResult = await sandbox.exec(
    `[ -d ${JSON.stringify(
      repoDir
    )}/.git ] && echo "exists" || echo "not exists"`
  );
  const repoExists = getOutput(checkRepoResult).trim() === "exists";
  console.log(`Repo exists: ${repoExists}`);

  if (repoExists) {
    // Step 5a: Update existing repo
    console.log("Updating existing repo from bundle");

    console.log("Fetching from bundle...");
    const fetchResult = await sandbox.exec(
      `cd ${JSON.stringify(repoDir)} && git fetch ${JSON.stringify(
        bundlePath
      )} 'refs/heads/*:refs/remotes/bundle/*'`
    );
    console.log("git fetch output:", getOutput(fetchResult));

    console.log("Switching to main branch...");
    const switchResult = await sandbox.exec(
      `cd ${JSON.stringify(repoDir)} && git switch -C main bundle/main`
    );
    console.log("git switch output:", getOutput(switchResult));

    console.log("Resetting to bundle/main...");
    const resetResult = await sandbox.exec(
      `cd ${JSON.stringify(repoDir)} && git reset --hard bundle/main`
    );
    console.log("git reset output:", getOutput(resetResult));

    console.log("Cleaning working directory...");
    const cleanResult = await sandbox.exec(
      `cd ${JSON.stringify(repoDir)} && git clean -fd`
    );
    console.log("git clean output:", getOutput(cleanResult));
  } else {
    // Step 5b: Clone fresh repo
    console.log("Cloning fresh repo from bundle");

    console.log("Removing existing directory if any...");
    const rmResult = await sandbox.exec(`rm -rf ${JSON.stringify(repoDir)}`);
    console.log("rm output:", getOutput(rmResult));

    console.log("Cloning bundle...");
    const cloneResult = await sandbox.exec(
      `git clone ${JSON.stringify(bundlePath)} ${JSON.stringify(repoDir)}`
    );
    console.log("git clone output:", getOutput(cloneResult));

    console.log("Ensuring main branch...");
    const ensureMainResult = await sandbox.exec(
      `cd ${JSON.stringify(
        repoDir
      )} && (git switch -C main || git checkout -B main)`
    );
    console.log("git branch output:", getOutput(ensureMainResult));
  }

  console.log("Successfully copied code to sandbox local filesystem");
}

export async function createMessage({
  userId,
  message,
  projectId,
  recentSandboxName,
  sender,
  env,
}: {
  userId: string;
  message: string;
  projectId: string;
  recentSandboxName: string;
  sender: SseEventSender;
  env: CloudflareBindings;
}): Promise<void> {
  // open sandbox
  const sandbox = getSandbox(env.Sandbox, recentSandboxName);

  const { ANTHROPIC_API_KEY } = env;

  // Set env vars for the session
  await sandbox.setEnvVars({ ANTHROPIC_API_KEY });

  // ensure the R2 bucket is mounted to sandbox
  const mountedFiles = await sandbox.exists("/mounted");
  console.log({ mountedFiles });
  if (!mountedFiles.exists) {
    await sandbox.mountBucket(env.REELLOLY_BUCKET_NAME, "/mounted", {
      endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: env.REELLOLY_BUCKET_ACCESS_KEY_ID,
        secretAccessKey: env.REELLOLY_BUCKET_SECRET_ACCESS_KEY,
      },
    });
  }
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
  await copyCodeToSandbox(sandbox, projectId, projectR2Path);

  // checkout the agent code to sandbox local filesystem
  await sandbox.exec("mkdir -p /sandbox/agent");
  console.log("ensured agent directory exists");
  await sandbox.gitCheckout(env.AGENT_REPO_URL, {
    targetDir: "/sandbox/agent",
  });
  console.log("checked out agent code");
  await sandbox.exec(`cd /sandbox/agent && bun install`);
  console.log("installed agent dependencies");
  // run agent with cwd set to the project directory and stream the response back to the client
  // Use shell variables with JSON.stringify to safely escape user input and prevent shell injection
  const stream = await sandbox.execStream(
    `MESSAGE=${JSON.stringify(message)} PROJECT_ID=${JSON.stringify(
      projectId
    )} && cd /sandbox/agent && bun run start "$MESSAGE" --cwd /sandbox/"$PROJECT_ID"/project`
  );
  for await (const event of parseSSEStream<ExecEvent>(stream)) {
    switch (event.type) {
      case "stdout":
        console.log({ stdout: event.data });
        await sender.sendEvent({
          id: crypto.randomUUID(),
          message: {
            type: "agent.message.delta",
            delta: event.data ?? "",
          },
        });
        break;

      case "stderr":
        console.error({ stderr: event.data, result: event.result });
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
