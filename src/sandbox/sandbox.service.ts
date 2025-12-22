import Sandbox from "@e2b/code-interpreter";
import { Lock } from "@upstash/lock";
import { Redis } from "@upstash/redis";
import invariant from "tiny-invariant";
import { getProjectR2Path, INIT_SCRIPT_PATH } from "@/constants";
import { env } from "@/env-helper";

export async function ensureSandboxIsInitializedWithLock({
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
		lease: 30_000, // Hold the lock for 30 seconds
		redis: Redis.fromEnv(),
	});

	const isLocked = await lock.acquire();
	if (!isLocked) {
		return { isWarm: false, error: "Sandbox is already initializing" };
	}

	try {
		return await ensureSandboxIsInitialized({ projectId, userId });
	} catch (error) {
		console.error("Failed to initialize sandbox:", error);
		return { isWarm: false, error: "Failed to initialize sandbox" };
	} finally {
		await lock.release();
	}
}

async function ensureSandboxIsInitialized({
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
	const projectR2Path = getProjectR2Path(userId, projectId, env.ENVIRONMENT);
	const appDir = `/home/user/${projectId}/app`;
	const bundlePath = `/mnt/${projectR2Path}/repo.bundle`;

	let sandbox: Sandbox;

	const paginator = Sandbox.list({
		query: {
			metadata: { projectId, userId },
		},
	});
	const sandboxes = await paginator.nextItems();
	if (sandboxes.length === 0) {
		console.log("No sandboxes found, creating new sandbox");
		sandbox = await Sandbox.create("e2b-template", {
			apiKey: env.E2B_API_KEY,
			metadata: {
				projectId,
				userId,
			},
			envs: {
				ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
			},
		});
	} else {
		invariant(sandboxes[0], "Sandbox not found");
		console.log("Sandbox already exists, connecting to existing sandbox");
		sandbox = await Sandbox.connect(sandboxes[0].sandboxId);
	}

	await ensureR2BucketIsMounted(sandbox);

	await ensureRepoIsReady(sandbox, appDir, bundlePath);

	await ensureServerIsRunning(sandbox, appDir);

	// Poll for server readiness (clone + install + dev server startup can take 30+ seconds)
	const maxAttempts = 60;
	const pollInterval = 1000;
	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, pollInterval));
		const check = await sandbox.commands.run(
			"curl -s -o /dev/null -w '%{http_code}' http://localhost:8080 || echo '000'",
		);
		if (check.stdout.trim() !== "000000") {
			console.log("Server is ready");
			break;
		}
	}

	const host = sandbox.getHost(8080);
	console.log("Server accessible at:", `https://${host}`);

	return { isWarm: true, previewUrl: `https://${host}` };
}

async function ensureR2BucketIsMounted(sandbox: Sandbox) {
	// Check if /mnt is already mounted
	const mountCheck = await sandbox.commands.run(
		"grep -qs ' /mnt ' /proc/mounts",
	);
	if (mountCheck.exitCode === 0) {
		console.log("/mnt is already mounted, skipping mount");
		return;
	}

	// Create a file with the R2 credentials
	// If you use another path for the credentials you need to add the path in the command s3fs command
	await sandbox.files.write(
		"/root/.passwd-s3fs",
		`${env.REELLOLY_BUCKET_ACCESS_KEY_ID}:${env.REELLOLY_BUCKET_SECRET_ACCESS_KEY}`,
	);
	await sandbox.commands.run("sudo chmod 600 /root/.passwd-s3fs");
	await sandbox.commands.run(
		`sudo s3fs -o url=https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com ${env.REELLOLY_BUCKET_NAME} /mnt`,
	);
}

async function ensureRepoIsReady(
	sandbox: Sandbox,
	targetDir: string,
	bundlePath: string,
) {
	const initScript = Bun.file(INIT_SCRIPT_PATH);
	await sandbox.files.write("/usr/local/bin/init.sh", await initScript.text());
	const result = await sandbox.commands.run(
		`chmod +x /usr/local/bin/init.sh && /usr/local/bin/init.sh '${targetDir}' '${bundlePath}'`,
	);
	console.log({ message: "init.sh result", result });
}

async function ensureServerIsRunning(sandbox: Sandbox, targetDir: string) {
	// Check if server is already running on port 8080
	const portCheck = await sandbox.commands.run(
		"lsof -ti:8080 || echo 'not_running'",
	);

	if (portCheck.stdout.trim() !== "not_running") {
		console.log("Server already running on port 8080, skipping startup");
		return;
	}

	console.log("Starting dev server...");
	const process = await sandbox.commands.run(
		`cd '${targetDir}' && bun run dev`,
		{
			background: true,
		},
	);
	console.log({ message: "process", process });
}
