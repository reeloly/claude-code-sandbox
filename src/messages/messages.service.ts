import Sandbox from "@e2b/code-interpreter";
import invariant from "tiny-invariant";
import type { SseEventSender } from "./messages.utils";

export async function createMessage({
	userId,
	message,
	projectId,
	sender,
}: {
	userId: string;
	message: string;
	projectId: string;
	sender: SseEventSender;
}): Promise<void> {
	const paginator = Sandbox.list({
		query: {
			metadata: { projectId, userId },
		},
	});
	const sandboxes = await paginator.nextItems();
	if (sandboxes.length === 0) {
		console.error({
			message: "No sandboxes found when creating message",
			projectId,
			userId,
		});
		throw new Error("No sandboxes found");
	}
	invariant(sandboxes[0], "Sandbox not found");
	const sandbox = await Sandbox.connect(sandboxes[0].sandboxId);

	await sandbox.commands.run(
		`cd /home/user/reeloly/reeloly-agent && bun run start '${message}' --cwd /home/user/${projectId}/app`,
		{
			onStdout: async (line) => {
				await sender.sendEvent({
					id: crypto.randomUUID(),
					message: {
						type: "agent.message.delta",
						delta: line,
					},
				});
			},
			onStderr: async (line) => {
				console.error({
					message: "messages.service stderr",
					line,
					projectId,
					userId,
				});
			},
		},
	);

	await sender.sendEvent({
		id: crypto.randomUUID(),
		message: {
			type: "agent.message.end",
		},
	});
}
