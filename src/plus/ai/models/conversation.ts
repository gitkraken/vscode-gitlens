import type { AIChatMessage } from './provider.js';

export class AIConversation {
	private _messages: AIChatMessage[] = [];

	get messages(): readonly AIChatMessage[] {
		return this._messages;
	}

	get length(): number {
		return this._messages.length;
	}

	get isEmpty(): boolean {
		return this._messages.length === 0;
	}

	addMessage(message: AIChatMessage): void {
		this._messages.push(message);
	}

	addMessages(messages: AIChatMessage[]): void {
		this._messages.push(...messages);
	}

	clear(): void {
		this._messages = [];
	}

	clone(): AIConversation {
		const conversation = new AIConversation();
		conversation._messages = [...this._messages];
		return conversation;
	}
}
