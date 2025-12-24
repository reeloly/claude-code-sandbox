import Sandbox from "@e2b/code-interpreter";
import { Lock } from "@upstash/lock";
import { Redis } from "@upstash/redis";
import invariant from "tiny-invariant";
import { env } from "@/env-helper";
import { copyProjectFilesFromR2ToSandbox } from "@/project-files/project-files.service";

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
	// const projectR2Path = getProjectR2Path(userId, projectId, env.ENVIRONMENT);
	const appDir = `/home/user/app`;
	// const bundlePath = `/mnt/${projectR2Path}/repo.bundle`;

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
				GOOGLE_API_KEY: env.GOOGLE_API_KEY,
			},
		});
	} else {
		invariant(sandboxes[0], "Sandbox not found");
		console.log({
			message: "Sandbox already exists, connecting to existing sandbox",
		});
		sandbox = await Sandbox.connect(sandboxes[0].sandboxId);
	}
	console.log({
		message: "Sandbox connected",
		timestamp: new Date().toISOString(),
	});

	await ensureProjectFilesAreReady(userId, projectId, sandbox);
	console.log({
		message: "Project files ready",
		timestamp: new Date().toISOString(),
	});

	await ensureServerIsRunning(sandbox, appDir);
	console.log({
		message: "Server running",
		timestamp: new Date().toISOString(),
	});

	const host = sandbox.getHost(8080);
	console.log("Server accessible at:", `https://${host}`, {
		timestamp: new Date().toISOString(),
	});

	return { isWarm: true, previewUrl: `https://${host}` };
}

async function ensureProjectFilesAreReady(
	userId: string,
	projectId: string,
	sandbox: Sandbox,
) {
	const projectFilesCheck = await sandbox.commands.run(
		`[[ -e /home/user/project.tar.gz && -f /home/user/project.tar.gz ]] && echo 'exists' || echo 'not_exists'`,
	);
	if (projectFilesCheck.stdout.trim() === "exists") {
		console.log({
			message: "Project files already exist, skipping copy",
			projectFilesCheck,
		});
		return;
	}
	await copyProjectFilesFromR2ToSandbox(userId, projectId, sandbox);
	const installResult = await sandbox.commands.run(
		`cd /home/user/app && bun install || echo 'Failed to install project files'`,
	);
	if (installResult.stdout.trim().includes("Failed to install project files")) {
		console.error({
			message: "Failed to install project files",
			installResult,
		});
		throw new Error("Failed to install project files");
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
