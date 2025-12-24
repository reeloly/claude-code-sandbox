import { z } from "zod";

const envSchema = z.object({
	ANTHROPIC_API_KEY: z.string(),
	CLERK_PUBLISHABLE_KEY: z.string(),
	CLERK_SECRET_KEY: z.string(),
	CLOUDFLARE_ACCOUNT_ID: z.string(),
	REELLOLY_BUCKET_ACCESS_KEY_ID: z.string(),
	REELLOLY_BUCKET_SECRET_ACCESS_KEY: z.string(),
	E2B_API_KEY: z.string(),
	UPSTASH_REDIS_REST_URL: z.string(),
	UPSTASH_REDIS_REST_TOKEN: z.string(),
	REELLOLY_BUCKET_NAME: z.string(),
	ENVIRONMENT: z.enum(["dev", "prod"]),
	AGENT_REPO_URL: z.string(),
	ALLOWED_ORIGINS: z.string().transform((val) => val.split(",")),
	GOOGLE_API_KEY: z.string(),
});

// Validate process.env against the schema
export const env = envSchema.parse(process.env);
