import z from "zod";

export type SseEvent = {
	id: string;
	message: EventMessage;
};

export type EventMessage =
	| AgentMessageDeltaEvent
	| AgentMessageEndEvent
	| AgentAskUserQuestionEvent;

export interface AgentMessageDeltaEvent {
	type: "agent.message.delta";
	delta: string;
}

export interface AgentMessageEndEvent {
	type: "agent.message.end";
}

export interface AgentAskUserQuestionEvent {
	type: "agent.ask.user.question";
	questions: AskUserQuestion["questions"];
}

export const askUserQuestionSchema = z.object({
	questions: z.array(
		z.object({
			question: z.string(),
			header: z.string(),
			options: z.array(
				z.object({
					label: z.string(),
					description: z.string(),
				}),
			),
			multiSelect: z.boolean(),
		}),
	),
});

export type AskUserQuestion = z.infer<typeof askUserQuestionSchema>;
