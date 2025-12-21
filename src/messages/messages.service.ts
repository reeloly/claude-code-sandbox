import type { SseEventSender } from "./messages.utils";

export async function createMessage({
  userId,
  message,
  projectId,
  recentSandboxName,
  sender,
}: {
  userId: string;
  message: string;
  projectId: string;
  recentSandboxName: string;
  sender: SseEventSender;
}): Promise<void> {
  await sender.sendEvent({
    id: crypto.randomUUID(),
    message: {
      type: "agent.message.end",
    },
  });
}
