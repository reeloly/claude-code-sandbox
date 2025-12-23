import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import Sandbox from "@e2b/code-interpreter";
import invariant from "tiny-invariant";
import { copyDotClaudeFromSandboxToR2 } from "@/dot-claude/dot-claude.service";
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

	let buffer = "";

	const processLine = async (line: string) => {
		if (line.trim() === "") {
			return;
		}
		let jsonMessage: SDKMessage;
		try {
			jsonMessage = JSON.parse(line) as SDKMessage;
		} catch (error) {
			console.error({
				message: "messages.service failed to parse JSON",
				line,
				error: error instanceof Error ? error.message : "Unknown error",
			});
			return;
		}
		console.log({ message: "messages.service message", jsonMessage });
		if (
			jsonMessage.type === "stream_event" &&
			jsonMessage.event.type === "content_block_delta" &&
			"text" in jsonMessage.event.delta
		) {
			await sender.sendEvent({
				id: crypto.randomUUID(),
				message: {
					type: "agent.message.delta",
					delta: jsonMessage.event.delta.text,
				},
			});
		}
	};

	// Start keepalive ping interval (5 seconds)
	const keepaliveInterval = setInterval(() => {
		sender.sendPing().catch((err) => {
			console.error({
				message: "Failed to send keepalive ping",
				error: err,
			});
		});
	}, 5000);

	try {
		await sandbox.commands.run(
			`cd /home/user/reeloly/reeloly-agent && TASK_INPUT='${message.replace(/'/g, "'\\''")}' bun run start --continue --cwd /home/user/${projectId}/app`,
			{
				timeoutMs: 120_000,
				onStdout: async (rawString) => {
					buffer += rawString;
					const lines = buffer.split("\n");

					// The last element is either "" (if it ended in \n)
					// or a partial line. Save it for the next chunk.
					buffer = lines.pop() ?? "";

					for (const line of lines) {
						await processLine(line);
					}
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

		// Process any remaining buffered content that didn't end with a newline
		if (buffer.trim() !== "") {
			await processLine(buffer);
		}

		await sender.sendEvent({
			id: crypto.randomUUID(),
			message: {
				type: "agent.message.end",
			},
		});

		await copyDotClaudeFromSandboxToR2(userId, projectId, sandbox);
	} catch (error) {
		console.error({
			message: "Failed to create message",
			error: error,
		});
		throw error;
	} finally {
		clearInterval(keepaliveInterval);
	}
}
