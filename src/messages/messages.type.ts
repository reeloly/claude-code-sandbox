export type SseEvent = {
  id: string;
  message: EventMessage;
};

export type EventMessage = AgentMessageDeltaEvent | AgentMessageEndEvent;

export interface AgentMessageDeltaEvent {
  type: "agent.message.delta";
  delta: string;
}

export interface AgentMessageEndEvent {
  type: "agent.message.end";
}
