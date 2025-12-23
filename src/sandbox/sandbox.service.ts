import Sandbox from "@e2b/code-interpreter";
import { Lock } from "@upstash/lock";
import { Redis } from "@upstash/redis";
import invariant from "tiny-invariant";
import {
	getProjectR2Path,
	INIT_SCRIPT_PATH,
	mountedDirectory,
} from "@/constants";
import { copyDotClaudeFromR2ToSandbox } from "@/dot-claude/dot-claude.service";
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
		console.error({
			message: "Failed to initialize sandbox",
			errorMessage: error instanceof Error ? error.message : "Unknown error",
		});
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
		console.log({ message: "No sandboxes found, creating new sandbox" });
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
		console.log({
			message: "Sandbox already exists, connecting to existing sandbox",
		});
		sandbox = await Sandbox.connect(sandboxes[0].sandboxId);
		console.log({ message: "Sandbox connected" });
	}

	await ensureR2BucketIsMounted(sandbox);
	console.log({ message: "R2 bucket mounted" });

	await ensureDotClaudeIsReady(userId, projectId, sandbox);
	console.log({ message: "Dot claude ready" });

	await ensureRepoIsReady(sandbox, appDir, bundlePath);
	console.log({ message: "Repo ready" });

	await ensureServerIsRunning(sandbox, appDir);
	console.log({ message: "Server running" });

	// Poll for server readiness (clone + install + dev server startup can take 30+ seconds)
	// const maxAttempts = 60;
	// const pollInterval = 1000;
	// for (let attempt = 0; attempt < maxAttempts; attempt++) {
	// 	await new Promise((resolve) => setTimeout(resolve, pollInterval));
	// 	const check = await sandbox.commands.run(
	// 		"curl -s -o /dev/null -w '%{http_code}' http://localhost:8080 || echo '000'",
	// 	);
	// 	if (check.stdout.trim() !== "000000") {
	// 		console.log("Server is ready");
	// 		break;
	// 	}
	// }

	const host = sandbox.getHost(8080);
	console.log("Server accessible at:", `https://${host}`);

	return { isWarm: true, previewUrl: `https://${host}` };
}

async function ensureR2BucketIsMounted(sandbox: Sandbox) {
	// Check if /mnt is already mounted
	const mountCheck = await sandbox.commands.run(
		"grep -qs ' /mnt ' /proc/mounts || echo 'not_mounted'",
	);
	if (mountCheck.stdout.trim() !== "not_mounted") {
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
		`sudo s3fs -o url=https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com -o allow_other -o umask=0022 -o uid=$(id -u user) -o gid=$(id -g user) ${env.REELLOLY_BUCKET_NAME} ${mountedDirectory}`,
	);
}

async function ensureDotClaudeIsReady(
	userId: string,
	projectId: string,
	sandbox: Sandbox,
) {
	await copyDotClaudeFromR2ToSandbox(userId, projectId, sandbox);
}

async function ensureRepoIsReady(
	sandbox: Sandbox,
	targetDir: string,
	bundlePath: string,
) {
	const initScript = Bun.file(INIT_SCRIPT_PATH);
	await sandbox.files.write("/usr/local/bin/init.sh", await initScript.text());
	console.log({ message: "init.sh written" });
	const result = await sandbox.commands.run(
		`chmod +x /usr/local/bin/init.sh && /usr/local/bin/init.sh '${targetDir}' '${bundlePath}' || echo 'init.sh failed'`,
		{
			onStdout: (line) => {
				console.log({ message: "init.sh stdout", line });
			},
			onStderr: (line) => {
				console.error({ message: "init.sh stderr", line });
			},
		},
	);
	console.log({ message: "init.sh result", result });
	if (result.stdout.trim().includes("init.sh failed")) {
		console.error({ message: "Failed to initialize repo", result });
		throw new Error("init.sh failed");
	}
}

async function ensureServerIsRunning(sandbox: Sandbox, targetDir: string) {
	// Check if server is already running on port 8080
	const portCheck = await sandbox.commands.run(
		"lsof -ti:8080 || echo 'not_running'",
	);
	console.log({ message: "portCheck", portCheck });

	if (portCheck.stdout.trim().includes("not_running")) {
		console.log("Starting dev server...");
		await sandbox.commands.run(
			`cd '${targetDir}' && bun run vite --port 8080`,
			{
				background: true,
				onStdout: (line) => {
					console.log({ message: "ensureServerIsRunning stdout", line });
				},
				onStderr: (line) => {
					console.error({ message: "stderr", line });
				},
			},
		);
	}
	console.log("checking if server is running");

	// wait for the localhost:8080 server to be running
	for (let i = 0; i < 10; i++) {
		console.log("waiting for server to be running", i);
		await Bun.sleep(1000);
		console.log({ message: "waiting for server to be running", i });
		const check = await sandbox.commands.run(
			"curl -s -o /dev/null -w '%{http_code}' http://localhost:8080 || echo '999'",
		);
		console.log({ message: "check", check });
		// '999' means curl failed to connect; any other value is an HTTP status code
		if (!check.stdout.trim().includes("999")) {
			console.log("Server is ready");
			break;
		}
	}
}
