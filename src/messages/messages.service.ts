import { setTimeout } from "node:timers/promises";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import Sandbox from "@e2b/code-interpreter";
import invariant from "tiny-invariant";
import { copyProjectFilesFromSandboxToR2 } from "@/project-files/project-files.service";
import {
	askUserQuestionSchema,
	type TodoWrite,
	todoWriteSchema,
} from "./messages.type";
import { ANSWERS_DIR, type SseEventSender } from "./messages.utils";

export async function createMessage({
	userId,
	message,
	projectId,
	images,
	sender,
}: {
	userId: string;
	message: string;
	projectId: string;
	images?: {
		base64: string;
		mimeType: string;
		name?: string;
	}[];
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

	const displayProgress = (todos: TodoWrite["todos"]) => {
		if (todos.length === 0) return;

		// const completed = todos.filter((t) => t.status === "completed").length;
		// const inProgress = todos.filter((t) => t.status === "in_progress").length;
		// const total = todos.length;

		// console.log(`\nProgress: ${completed}/${total} completed`);
		// console.log(`Currently working on: ${inProgress} task(s)\n`);
		try {
			todos.forEach((todo, index) => {
				const icon =
					todo.status === "completed"
						? "✅"
						: todo.status === "in_progress"
							? "🔧"
							: "❌";
				const text =
					todo.status === "in_progress" ? todo.activeForm : todo.content;
				console.log(`${index + 1}. ${icon} ${text}`);
			});
		} catch (error) {
			console.error({
				message: "Failed to display progress",
				todos,
				error: error instanceof Error ? error.message : "Unknown error",
			});
		}
	};

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
		} else if (
			jsonMessage.type === "stream_event" &&
			jsonMessage.event.type === "content_block_stop"
		) {
			await sender.sendEvent({
				id: crypto.randomUUID(),
				message: {
					type: "agent.message.delta",
					delta: "\n",
				},
			});
		} else if (jsonMessage.type === "assistant") {
			for (const block of jsonMessage.message.content) {
				if (block.type === "tool_use") {
					if (block.name === "TodoWrite") {
						const { todos } = todoWriteSchema.parse(block.input);
						displayProgress(todos);
					} else if (block.name === "AskUserQuestion") {
						console.log({ message: "messages.service AskUserQuestion", block });
						const { questions } = askUserQuestionSchema.parse(block.input);
						await sender.sendEvent({
							id: crypto.randomUUID(),
							message: {
								type: "agent.ask.user.question",
								toolUseId: block.id,
								questions,
							},
						});
					} else {
						console.log({ message: "messages.service tool_use", block });
					}
				}
			}
		}
	};

	// Define a control flag or AbortController to stop the loop later if needed
	const controller = new AbortController();
	const { signal } = controller;
	async function startKeepAlive() {
		try {
			while (!signal.aborted) {
				await sandbox.setTimeout(30_000);
				try {
					await sender.sendPing();
				} catch (e) {
					console.error("Ping failed", e);
				}

				await setTimeout(5000, undefined, { signal });
			}
		} catch (error) {
			if (signal.aborted) {
				console.log("Keepalive stopped immediately.");
			} else {
				throw error;
			}
		}
	}

	startKeepAlive();

	try {
		// Write images to sandbox if provided
		if (images && images.length > 0) {
			await sandbox.files.makeDir("/home/user/task-images");
			for (const [i, image] of images.entries()) {
				const ext = image.mimeType.split("/")[1] || "png";
				const filename = image.name || `image-${i}.${ext}`;
				const arrayBuffer = Uint8Array.from(atob(image.base64), (c) =>
					c.charCodeAt(0),
				).buffer;
				await sandbox.files.write(
					`/home/user/task-images/${filename}`,
					arrayBuffer,
				);
			}
		}

		// Build image metadata for the agent
		const imagesMeta =
			images?.map((img, i) => ({
				path: `/home/user/task-images/${img.name || `image-${i}.${img.mimeType.split("/")[1] || "png"}`}`,
				mediaType: img.mimeType,
			})) ?? [];

		const taskImagesEnv =
			imagesMeta.length > 0
				? `TASK_IMAGES='${JSON.stringify(imagesMeta).replace(/'/g, "'\\''")}'`
				: "";
		console.log({ message: "taskImagesEnv", taskImagesEnv });

		const escapedMessage = message.replace(/'/g, "'\\''");

		await sandbox.commands.run(
			`cd /home/user/reeloly/reeloly-agent && TASK_INPUT='${escapedMessage}' ${taskImagesEnv} bun run start --continue --cwd /home/user/app`,
			{
				timeoutMs: 0, // Disable timeout - agent operations can take a long time
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

		await copyProjectFilesFromSandboxToR2(userId, projectId, sandbox);
	} catch (error) {
		console.error({
			message: "Failed to create message",
			error: error,
		});
		throw error;
	} finally {
		controller.abort();
	}
}

export async function answerUserQuestion({
	userId,
	projectId,
	toolUseId,
	answers,
}: {
	userId: string;
	projectId: string;
	toolUseId: string;
	answers: Record<string, string>;
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
		`mkdir -p ${ANSWERS_DIR} && echo '${JSON.stringify({ answers })}' > ${ANSWERS_DIR}/${toolUseId}.json`,
		{
			timeoutMs: 120_000,
		},
	);
}
