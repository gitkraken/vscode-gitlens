import { AIError, AIErrorReason } from '@gitlens/ai/errors.js';
import type { AIActionType, AIModel } from '@gitlens/ai/models/model.js';
import type {
	AIChatMessage,
	AIChatMessageRole,
	AIProvider,
	AIProviderResponse,
	AIToolCall,
} from '@gitlens/ai/models/provider.js';
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
	{
		id: 'quota',
		name: 'Simulator: Quota',
		maxTokens: { input: 200000, output: 32000 },
		provider: simulatorProviderDescriptor,
	},
];

/**
 * Prefix marking an injected response as a tool call rather than text. The payload is
 * `{ name, args }` (or an array of those for a parallel round), e.g.
 *
 * ```
 * @@tool-call@@ {"name":"grep","args":{"reason":"is it still used?","pattern":"useTimeout"}}
 * ```
 *
 * Injects are a per-action FIFO queue, so a multi-step agentic loop is scripted by injecting the
 * tool call(s) first and the final answer last. Without this, the simulator can only ever produce a
 * single-shot text reply — which makes any tool-using feature (AI conflict resolution's repo
 * consultation) unreachable under the simulator.
 */
const toolCallInjectPrefix = '@@tool-call@@';

interface InjectedToolCall {
	name: string;
	args?: Record<string, unknown>;
	/** Echoed back as `providerSignature`, to exercise the GitKraken proxy's `thought_signature` round-trip. */
	providerSignature?: string;
}

/** Parses a `@@tool-call@@`-prefixed inject into tool calls; returns undefined for plain text. */
function parseInjectedToolCalls(content: string): AIToolCall[] | undefined {
	const trimmed = content.trimStart();
	if (!trimmed.startsWith(toolCallInjectPrefix)) return undefined;

	const payload = trimmed.slice(toolCallInjectPrefix.length).trim();
	let parsed;
	try {
		parsed = JSON.parse(payload) as InjectedToolCall | InjectedToolCall[];
	} catch {
		throw new Error(`(Simulator) Malformed ${toolCallInjectPrefix} payload — expected JSON: ${payload}`);
	}

	const calls = Array.isArray(parsed) ? parsed : [parsed];
	return calls.map((c, i) => ({
		id: `sim-tool-${i}-${uuid()}`,
		name: c.name,
		args: c.args ?? {},
		...(c.providerSignature != null ? { providerSignature: c.providerSignature } : undefined),
	}));
}

export class SimulatorProvider implements AIProvider<'simulator'> {
	readonly id = 'simulator' as const;
	readonly name = 'Simulator (Debugging)';
	// Advertise tools so tool-using features are reachable here. The simulator only *emits* a tool
	// call when one is injected, so default behavior is unchanged.
	readonly supportsTools = true;

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
		getMessages: (maxInputTokens: number, retries: number) => Promise<AIChatMessage<AIChatMessageRole>[]>,
		options: {
			signal: AbortSignal;
			modelOptions?: { outputTokens?: number; temperature?: number };
			tools?: readonly { name: string }[];
		},
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

		if (mode === 'quota') {
			throw new AIError(
				AIErrorReason.UserQuotaExceeded,
				new Error('(Simulator) Simulated weekly AI credit limit reached for verification'),
			);
		}

		if (mode === 'slow') {
			await delay(state.slowDelayMs, options.signal);
		}

		// Layered resolution: injects > mode override > built-in default.
		const injected = state.pop(action);

		// An injected `@@tool-call@@` turns this step into a tool call instead of a final answer, so a
		// multi-step loop can be scripted.
		const toolCalls = injected != null ? parseInjectedToolCalls(injected) : undefined;
		if (toolCalls != null) {
			// Handing back a tool call nobody offered tools for would be silently undispatchable, so
			// fail loudly instead of letting the sentinel leak out as response text.
			if (!options.tools?.length) {
				throw new Error(
					`(Simulator) A ${toolCallInjectPrefix} response was injected for '${action}', but the caller offered no tools. Either the feature doesn't use tool calls, or the resolved provider isn't tool-capable.`,
				);
			}

			return {
				id: uuid(),
				// Real providers send no text (or null) alongside a tool-call-only turn
				content: '',
				toolCalls: toolCalls,
				model: model,
				usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
				result: undefined,
			};
		}

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
