import { Lock } from "@upstash/lock";
import { Redis } from "@upstash/redis";

export async function ensureSandboxIsInitialized({
  projectId,
  userId,
}: {
  projectId: string;
  userId: string;
}): Promise<{
  isWarm: boolean;
  previewUrl?: string;
  error?: string;
}> {
  const lock = new Lock({
    id: projectId,
    lease: 5000, // Hold the lock for 5 seconds
    redis: Redis.fromEnv(),
  });

  const isLocked = await lock.acquire();
  if (!isLocked) {
    return { isWarm: false, error: "Sandbox is already initializing" };
  }

  try {
    throw new Error("Not implemented");
  } catch (error) {
    console.error("Failed to initialize sandbox:", error);
    return { isWarm: false, error: "Failed to initialize sandbox" };
  } finally {
    await lock.release();
  }
}
