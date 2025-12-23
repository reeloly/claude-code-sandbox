import type Sandbox from "@e2b/code-interpreter";
import { env } from "@/env-helper";

export async function copyDotClaudeFromR2ToSandbox(
	userId: string,
	projectId: string,
	sandbox: Sandbox,
) {
	const rcloneConfigContent = `
[r2]
type = s3
provider = Cloudflare
access_key_id = ${env.REELLOLY_BUCKET_ACCESS_KEY_ID}
secret_access_key = ${env.REELLOLY_BUCKET_SECRET_ACCESS_KEY}
endpoint = https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com
acl = private
`;
	const isRcloneConfigExists = await sandbox.files.exists(
		"/home/user/.config/rclone/rclone.conf",
	);
	if (!isRcloneConfigExists) {
		await sandbox.files.write(
			"/home/user/.config/rclone/rclone.conf",
			rcloneConfigContent,
		);
	}

	const dotClaudePathOnR2 = `r2:reeloly/dev/users/${userId}/projects/${projectId}/dot-claude`;
	const dotClaudePathOnSandbox = "/home/user/.claude";
	const result = await sandbox.commands.run(
		`rclone lsf ${dotClaudePathOnR2} && rclone sync ${dotClaudePathOnR2} ${dotClaudePathOnSandbox} || echo 'Failed to sync dot claude from r2 to sandbox'`,
	);
	if (
		result.stdout
			.trim()
			.includes("Failed to sync dot claude from r2 to sandbox")
	) {
		console.error({
			message: "Failed to sync dot claude from r2 to sandbox",
			result,
		});
		throw new Error("Failed to sync dot claude from r2 to sandbox");
	}
}

export async function copyDotClaudeFromSandboxToR2(
	userId: string,
	projectId: string,
	sandbox: Sandbox,
) {
	const dotClaudePathOnSandbox = "/home/user/.claude";
	const dotClaudePathOnR2 = `r2:reeloly/dev/users/${userId}/projects/${projectId}/dot-claude`;
	const result = await sandbox.commands.run(
		`mkdir -p ${dotClaudePathOnR2} && rclone sync ${dotClaudePathOnSandbox} ${dotClaudePathOnR2} || echo 'Failed to sync dot claude from sandbox to r2'`,
	);
	console.log({ message: "copyDotClaudeFromSandboxToR2 result", result });
	if (
		result.stdout
			.trim()
			.includes("Failed to sync dot claude from sandbox to r2")
	) {
		console.error({
			message: "Failed to sync dot claude from sandbox to r2",
			result,
		});
		throw new Error("Failed to sync dot claude from sandbox to r2");
	}
}
