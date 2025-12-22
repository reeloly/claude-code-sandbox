import { Hono } from "hono";
import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import z from "zod";
import { authMiddleware } from "@/middleware/auth";
import { ensureSandboxIsInitializedWithLock } from "@/sandbox/sandbox.service";

export const sandboxRoutes = new Hono();

const validator = zValidator(
	"query",
	z.object({
		projectId: z.string(),
	}),
	(result, c) => {
		if (!result.success) {
			return c.json({ error: result.error }, 400);
		}
	},
);

const statusResponseSchema = z.object({
	isWarm: z.boolean(),
	previewUrl: z.string().optional(),
	error: z.string().optional(),
});

sandboxRoutes.get(
	"/status",
	authMiddleware,
	validator,
	describeRoute({
		responses: {
			200: {
				description: "Sandbox status",
				content: {
					"application/json": {
						schema: resolver(statusResponseSchema),
					},
				},
			},
		},
	}),
	async (c) => {
		const projectId = c.req.valid("query").projectId;

		// Validate projectId to prevent shell injection - only allow alphanumeric, hyphens, underscores
		if (!projectId || !/^[\w-]+$/.test(projectId)) {
			console.error(`Invalid project ID: ${projectId}, url: ${c.req.url}`);
			return c.json({ error: `Invalid project ID: ${projectId}` }, 400);
		}

		// Validate userId to prevent shell injection (defense in depth)
		const userId = c.get("userId");
		if (!userId || !/^[\w-]+$/.test(userId)) {
			console.error(`Invalid user ID: ${userId}, url: ${c.req.url}`);
			return c.json({ error: `Invalid user ID: ${userId}` }, 401);
		}

		const result = await ensureSandboxIsInitializedWithLock({
			projectId,
			userId,
		});
		if (result.isWarm) {
			return c.json({ isWarm: true, previewUrl: result.previewUrl }, 200);
		}
		return c.json({ isWarm: false, error: result.error }, 500);
	},
);
