import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { validator as zValidator } from "hono-openapi";
import z from "zod";
import { authMiddleware } from "../middleware/auth";
import { answerUserQuestion, createMessage } from "./messages.service";
import { HonoSSESender } from "./messages.utils";

export const messagesRoutes = new Hono();

const validator = zValidator(
	"json",
	z.object({
		message: z.string(),
		projectId: z.string(),
		images: z
			.array(
				z.object({
					base64: z.string(),
					mimeType: z.enum([
						"image/png",
						"image/jpeg",
						"image/webp",
						"image/gif",
					]),
					name: z.string().optional(),
				}),
			)
			.optional()
			.describe("Base64 encoded images to upload to the sandbox"),
	}),
	(result, c) => {
		if (!result.success) {
			console.error({
				message: "Invalid request body",
				error: result.error,
			});
			return c.json({ error: result.error }, 400);
		}
	},
);

messagesRoutes.post("/", authMiddleware, validator, async (c) => {
	const { message, projectId, images } = c.req.valid("json");
	const userId = c.get("userId");

	console.log({
		message: "Creating message",
		userId,
		task: message,
		projectId,
	});
	return streamSSE(c, async (stream) => {
		const sender = new HonoSSESender(stream);

		await createMessage({
			userId,
			message,
			projectId,
			images,
			sender,
		});
	});
});

const answersValidator = zValidator(
	"json",
	z.object({
		projectId: z.string(),
		toolUseId: z.string(),
		answers: z.record(z.string(), z.string()),
	}),
	(result, c) => {
		if (!result.success) {
			return c.json({ error: result.error }, 400);
		}
	},
);

messagesRoutes.post("/answers", authMiddleware, answersValidator, async (c) => {
	const userId = c.get("userId");
	const { projectId, toolUseId, answers } = c.req.valid("json");

	await answerUserQuestion({ userId, projectId, toolUseId, answers });

	return c.json({ message: "Answers saved" });
});
