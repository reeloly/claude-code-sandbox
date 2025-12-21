import { getSandbox } from "@cloudflare/sandbox";
import { getProjectR2Path } from "@/constants";

export async function ensureSandboxIsInitialized({
  projectId,
  userId,
  env,
}: {
  projectId: string;
  userId: string;
  env: CloudflareBindings;
}) {
  const sandboxLockId = env.SandboxLock.idFromName(projectId);
  const sandboxLock = env.SandboxLock.get(sandboxLockId);
  const isLocked = await sandboxLock.acquire();
  if (!isLocked) {
    return { isWarm: false, error: "Sandbox is already initializing" };
  }

  const sandbox = getSandbox(env.Sandbox, projectId);

  const projectR2Path = getProjectR2Path(userId, projectId, env.ENVIRONMENT);
  const appDir = `/workspace/${projectId}/app`;
  const bundlePath = `/mnt/${projectR2Path}/repo.bundle`;
  const hostname = `reelolyproject.com`;

  try {
    const exposedPorts = await sandbox.getExposedPorts(hostname);
    if (exposedPorts.length > 0) {
      return { isWarm: true, previewUrl: exposedPorts[0].url };
    }

    await sandbox.setEnvVars({
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
    });

    const mountedFiles = await sandbox.exists("/mnt");
    console.log("Mounted files:", mountedFiles);
    if (!mountedFiles.exists) {
      console.log("Mounting R2 bucket to sandbox");
      await sandbox.mountBucket(env.REELLOLY_BUCKET_NAME, "/mnt", {
        endpoint: `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: env.REELLOLY_BUCKET_ACCESS_KEY_ID,
          secretAccessKey: env.REELLOLY_BUCKET_SECRET_ACCESS_KEY,
        },
      });
    }

    const result = await sandbox.exec(
      `/usr/local/bin/init.sh '${appDir}' '${bundlePath}'`
    );
    console.log({ message: "init.sh result", result });

    const process = await sandbox.startProcess(`cd '${appDir}' && bun run dev`);
    console.log({ message: "process", process });

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
    return { isWarm: true, previewUrl: exposed.url };
  } catch (error) {
    console.error("Failed to initialize sandbox:", error);
    return { isWarm: false, error: "Failed to initialize sandbox" };
  } finally {
    await sandboxLock.release();
  }
}
