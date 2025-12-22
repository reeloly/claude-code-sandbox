import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { validator as zValidator } from "hono-openapi";
import z from "zod";
import { authMiddleware } from "../middleware/auth";
import { createMessage } from "./messages.service";
import { HonoSSESender } from "./messages.utils";

export const messagesRoutes = new Hono();

const validator = zValidator(
	"json",
	z.object({
		message: z.string(),
		projectId: z.string(),
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
	const { message, projectId } = c.req.valid("json");
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
			sender,
		});
	});
});
