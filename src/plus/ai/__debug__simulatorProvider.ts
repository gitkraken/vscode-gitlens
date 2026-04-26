import { AIError, AIErrorReason } from '@gitlens/ai/errors.js';
import type { AIActionType, AIModel } from '@gitlens/ai/models/model.js';
import type { AIChatMessage, AIProvider, AIProviderResponse } from '@gitlens/ai/models/provider.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import { uuid } from '@gitlens/utils/crypto.js';
import { getDefaultResponse, getInvalidResponse } from './__debug__simulatorResponses.js';
import { getSimulatorState } from './__debug__simulatorState.js';

const simulatorProviderDescriptor = { id: 'simulator' as const, name: 'Simulator (Debugging)' };

const simulatorModels: readonly AIModel<'simulator'>[] = [
	{
		id: 'default',
		name: 'Simulator: Default',
		maxTokens: { input: 200000, output: 32000 },
		provider: simulatorProviderDescriptor,
		default: true,
	},
	{
		id: 'slow',
		name: 'Simulator: Slow',
		maxTokens: { input: 200000, output: 32000 },
		provider: simulatorProviderDescriptor,
	},
	{
		id: 'invalid',
		name: 'Simulator: Invalid',
		maxTokens: { input: 200000, output: 32000 },
		provider: simulatorProviderDescriptor,
	},
	{
		id: 'error',
		name: 'Simulator: Error',
		maxTokens: { input: 200000, output: 32000 },
		provider: simulatorProviderDescriptor,
	},
	{
		id: 'cancel',
		name: 'Simulator: Cancel',
		maxTokens: { input: 200000, output: 32000 },
		provider: simulatorProviderDescriptor,
	},
];

export class SimulatorProvider implements AIProvider<'simulator'> {
	readonly id = 'simulator' as const;
	readonly name = 'Simulator (Debugging)';

	dispose(): void {
		// no-op
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	configured(_silent: boolean): Promise<boolean> {
		return Promise.resolve(true);
	}

	getApiKey(_silent: boolean): Promise<string | undefined> {
		return Promise.resolve('simulator');
	}

	getModels(): Promise<readonly AIModel<'simulator'>[]> {
		return Promise.resolve(simulatorModels);
	}

	async sendRequest<TAction extends AIActionType>(
		action: TAction,
		model: AIModel<'simulator'>,
		_apiKey: string,
		getMessages: (maxInputTokens: number, retries: number) => Promise<AIChatMessage[]>,
		options: { signal: AbortSignal; modelOptions?: { outputTokens?: number; temperature?: number } },
	): Promise<AIProviderResponse<void> | undefined> {
		const state = getSimulatorState();

		// Run the prompt-building flow for parity (token budgeting, truncation, etc.) and
		// capture the messages so an agent can read them back via the lastMessages command.
		const messages = await getMessages(model.maxTokens.input, 0);
		state.recordMessages(messages);

		// Resolve mode — explicit model id overrides the global mode.
		const mode = model.id === 'default' ? state.mode : (model.id as typeof state.mode);

		if (mode === 'cancel') {
			throw new CancellationError();
		}

		if (mode === 'error') {
			throw new AIError(
				AIErrorReason.RateLimitOrFundsExceeded,
				new Error('(Simulator) Simulated provider failure for verification'),
			);
		}

		if (mode === 'slow') {
			await delay(state.slowDelayMs, options.signal);
		}

		// Layered resolution: injects > mode override > built-in default.
		const injected = state.pop(action);
		const content = injected ?? (mode === 'invalid' ? getInvalidResponse(action) : getDefaultResponse(action));

		const promptTokens = messages.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);
		const completionTokens = Math.ceil(content.length / 4);

		return {
			id: uuid(),
			content: content,
			model: model,
			usage: {
				promptTokens: promptTokens,
				completionTokens: completionTokens,
				totalTokens: promptTokens + completionTokens,
			},
			result: undefined,
		};
	}
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new CancellationError());
			return;
		}
		let timer: ReturnType<typeof setTimeout>;
		const onAbort = (): void => {
			clearTimeout(timer);
			reject(new CancellationError());
		};
		timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		signal.addEventListener('abort', onAbort, { once: true });
	});
}
