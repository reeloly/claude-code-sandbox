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
	toolUseId: string;
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

export const todoWriteSchema = z.object({
	todos: z.array(
		z.object({
			content: z.string(),
			status: z.enum(["pending", "in_progress", "completed"]),
			activeForm: z.string(),
		}),
	),
});

export type TodoWrite = z.infer<typeof todoWriteSchema>;
