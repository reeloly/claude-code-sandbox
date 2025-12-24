import type Sandbox from "@e2b/code-interpreter";
import { env } from "@/env-helper";

export async function copyProjectFilesFromR2ToSandbox(
	userId: string,
	projectId: string,
	sandbox: Sandbox,
) {
	const gzippedFilePathOnR2 = `r2:reeloly/${env.ENVIRONMENT}/users/${userId}/projects/${projectId}/project.tar.gz`;
	const gzippedFilePathOnSandbox = `/home/user/project.tar.gz`;
	const result = await sandbox.commands.run(
		`rclone lsf ${gzippedFilePathOnR2} && rclone copyto ${gzippedFilePathOnR2} ${gzippedFilePathOnSandbox} || echo 'Failed to sync project files from r2 to sandbox'`,
	);
	if (
		result.stdout
			.trim()
			.includes("Failed to sync project files from r2 to sandbox")
	) {
		console.error({
			message: "Failed to sync project files from r2 to sandbox",
			result,
		});
		throw new Error("Failed to sync project files from r2 to sandbox");
	}

	const unzippedFilePathOnSandbox = `/home/user`;
	const unzipResult = await sandbox.commands.run(
		`tar -xzf ${gzippedFilePathOnSandbox} -C ${unzippedFilePathOnSandbox} || echo 'Failed to unzip project files'`,
	);
	if (unzipResult.stdout.trim().includes("Failed to unzip project files")) {
		console.error({ message: "Failed to unzip project files", unzipResult });
		throw new Error("Failed to unzip project files");
	}
}

export async function copyProjectFilesFromSandboxToR2(
	userId: string,
	projectId: string,
	sandbox: Sandbox,
) {
	const gzippedFilePathOnSandbox = `/home/user/project.tar.gz`;
	const gzippedFilePathOnR2 = `r2:reeloly/${env.ENVIRONMENT}/users/${userId}/projects/${projectId}/project.tar.gz`;

	const result = await sandbox.commands.run(
		`cd /home/user && \
    tar -czf project.tar.gz \
    --exclude='node_modules' \
    --exclude='.bun' \
    --exclude='project.tar.gz' \
    --exclude='.env' \
    app .claude && \
    rclone copyto ${gzippedFilePathOnSandbox} ${gzippedFilePathOnR2} || echo 'Failed to sync project files from sandbox to r2'`,
	);

	if (
		result.stdout
			.trim()
			.includes("Failed to sync project files from sandbox to r2")
	) {
		console.error({
			message: "Failed to sync project files from sandbox to r2",
			result,
		});
		throw new Error("Failed to sync project files from sandbox to r2");
	}
}
