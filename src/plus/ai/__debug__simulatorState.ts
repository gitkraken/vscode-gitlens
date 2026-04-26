import type { AIActionType } from '@gitlens/ai/models/model.js';
import type { AIChatMessage } from '@gitlens/ai/models/provider.js';

export type SimulatorMode = 'default' | 'slow' | 'invalid' | 'error' | 'cancel';

export interface SimulatorInject {
	readonly action?: AIActionType;
	readonly content: string;
	readonly sticky?: boolean;
}

export class SimulatorState {
	mode: SimulatorMode = 'default';
	slowDelayMs = 1500;

	private readonly actionStash = new Map<AIActionType, string[]>();
	private readonly nextStash: string[] = [];
	private readonly stickyByAction = new Map<AIActionType, string>();
	private lastMessages: AIChatMessage[] | undefined;
	private callCount = 0;

	inject(inject: SimulatorInject): void {
		if (inject.action != null) {
			if (inject.sticky) {
				this.stickyByAction.set(inject.action, inject.content);
				return;
			}

			let queue = this.actionStash.get(inject.action);
			if (queue == null) {
				queue = [];
				this.actionStash.set(inject.action, queue);
			}
			queue.push(inject.content);
			return;
		}

		this.nextStash.push(inject.content);
	}

	pop(action: AIActionType): string | undefined {
		const queue = this.actionStash.get(action);
		if (queue?.length) return queue.shift();

		if (this.nextStash.length) return this.nextStash.shift();

		return this.stickyByAction.get(action);
	}

	clear(): void {
		this.actionStash.clear();
		this.nextStash.length = 0;
		this.stickyByAction.clear();
	}

	recordMessages(messages: readonly AIChatMessage[]): void {
		this.lastMessages = [...messages];
		this.callCount++;
	}

	getLastMessages(): readonly AIChatMessage[] | undefined {
		return this.lastMessages;
	}

	getCallCount(): number {
		return this.callCount;
	}

	resetCallCount(): void {
		this.callCount = 0;
	}
}

let _state: SimulatorState | undefined;

export function getSimulatorState(): SimulatorState {
	return (_state ??= new SimulatorState());
}
