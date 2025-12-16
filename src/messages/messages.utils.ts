import type { SSEStreamingApi } from "hono/streaming";
import type { SseEvent } from "./messages.type";

export interface SseEventSender {
  sendEvent(data: SseEvent): Promise<void>;
  sendPing(): Promise<void>;
}

export class HonoSSESender implements SseEventSender {
  constructor(private stream: SSEStreamingApi) {}

  async sendEvent(data: SseEvent) {
    await this.stream.writeSSE({
      data: JSON.stringify(data.message),
      event: data.message.type,
      id: data.id,
    });
  }

  async sendPing() {
    await this.stream.writeSSE({
      data: JSON.stringify({}),
      event: "ping",
      id: crypto.randomUUID(),
    });
  }
}
