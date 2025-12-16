import { getSandbox } from "@cloudflare/sandbox";
import type { SseEventSender } from "./messages.utils";

export async function createMessage({
  userId,
  message,
  projectId,
  sender,
  env,
}: {
  userId: string;
  message: string;
  projectId: string;
  sender: SseEventSender;
  env: CloudflareBindings;
}): Promise<void> {
  // open sandbox
  const sandbox = getSandbox(env.Sandbox, crypto.randomUUID().slice(0, 8));

  const { ANTHROPIC_API_KEY } = env;

  // Set env vars for the session
  await sandbox.setEnvVars({ ANTHROPIC_API_KEY });

  // TODO: ensure the project directory exists in R2
  // TODO: mount the project directory to sandbox
  // TODO: ensure the local disk has code, which is either pulled from github or copied from mounted directory
  // TODO: run agent with cwd set to the project directory
  // TODO: stream the response back to the client
  // TODO: when agent is done, copy the code from local disk to mounted directory
  // TODO: when agent is done, build the project and copy the build output to R2 for preview

  const response = `${userId} says: ${message} in project ${projectId}`;
  for (const chunk of response.split(" ")) {
    await sender.sendEvent({
      id: crypto.randomUUID(),
      message: {
        type: "agent.message.delta",
        delta: chunk,
      },
    });
  }

  await sender.sendEvent({
    id: crypto.randomUUID(),
    message: {
      type: "agent.message.end",
    },
  });
}
