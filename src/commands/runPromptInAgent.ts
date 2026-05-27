import { window } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import type { Sources } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import type { AgentDescriptor } from '../plus/agents/agentDescriptor.js';
import { runAgent } from '../plus/agents/agentDispatch.js';
import { pickAgentStandalone } from '../plus/agents/agentPicker.js';
import { resolveDefaultAgent } from '../plus/agents/agentRegistry.js';
import type { ChatMode } from '../plus/chat/utils/-webview/chat.utils.js';
import { command } from '../system/-webview/command.js';
import { configuration } from '../system/-webview/configuration.js';
import { GlCommandBase } from './commandBase.js';

export interface RunPromptInAgentCommandArgs {
	/** The fully-rendered prompt to dispatch to the picked agent. */
	prompt: string;
	/** Working directory for the CLI dispatch path. Ignored by IDE chat / extension dispatches. */
	cwd?: string;
	/** When set, dispatch to this descriptor directly and skip the picker. Used by callers that
	 *  have already resolved the agent (e.g., the wizard-driven `startWork` / `startReview` flows). */
	agent?: AgentDescriptor;
	/** When true, request the host to auto-submit the prompt (Copilot Chat only). */
	autoExecute?: boolean;
	/** Chat mode hint for the IDE chat path (Copilot Chat only). */
	mode?: ChatMode;
	/** Telemetry source — emitted on dispatch-failure tracks for cross-surface attribution. */
	source?: Sources;
}

/** Runs an already-rendered prompt in an agent (IDE chat, Claude extension, or detected CLI).
 *  Resolves the descriptor as `args.agent` > persisted `gitlens.ai.defaultAgent` > picker. */
@command()
export class RunPromptInAgentCommand extends GlCommandBase {
	private static readonly maxRetries = 2;

	constructor(private readonly container: Container) {
		super('gitlens.runPromptInAgent');
	}

	async execute(args?: RunPromptInAgentCommandArgs): Promise<void> {
		if (!args?.prompt) {
			throw new Error('Prompt is required for runPromptInAgent command');
		}

		const descriptor = await this.resolveAgent(args.agent);
		if (descriptor == null) return;

		await this.dispatch(descriptor, args);
	}

	private async resolveAgent(preselected: AgentDescriptor | undefined): Promise<AgentDescriptor | undefined> {
		if (preselected != null) return preselected;

		// `resolveDefaultAgent` returns only descriptors that pass the supported-agents filter,
		// so no extra availability check is needed here — `runAgent` re-validates at dispatch time.
		const persistedId = configuration.get('ai.defaultAgent') ?? undefined;
		if (persistedId != null) {
			const descriptor = await resolveDefaultAgent(persistedId);
			if (descriptor != null) return descriptor;
		}

		return pickAgentStandalone();
	}

	private async dispatch(descriptor: AgentDescriptor, args: RunPromptInAgentCommandArgs, retries = 0): Promise<void> {
		const result = await runAgent(descriptor, args.prompt, {
			cwd: args.cwd,
			autoExecute: args.autoExecute,
			mode: args.mode,
		});
		if (result.success) return;

		void this.container.usage.track('action:gitlens.ai.openInAgent.dispatchFailed:happened');
		Logger.error(
			result.error ?? new Error('Unknown dispatch failure'),
			'RunPromptInAgent',
			`dispatch kind=${descriptor.kind} agentId=${descriptor.id} source=${args.source ?? '?'} retries=${retries}`,
		);

		// Cap Retry after `maxRetries` attempts so a misconfigured agent can't trap the user
		// in a retry loop (every CLI retry spawns a fresh terminal). "Pick another agent"
		// and dismissing the toast both remain as escapes.
		const retryAction = 'Retry';
		const pickAnotherAction = 'Pick another agent';
		const canRetry = retries < RunPromptInAgentCommand.maxRetries;
		const actions = canRetry ? [retryAction, pickAnotherAction] : [pickAnotherAction];

		const choice = await window.showWarningMessage(
			`Couldn't reach ${descriptor.label}${result.clipboardCopiedAsFallback ? '. Prompt copied to clipboard.' : '.'}`,
			...actions,
		);

		if (choice === retryAction) {
			await this.dispatch(descriptor, args, retries + 1);
			return;
		}

		if (choice === pickAnotherAction) {
			const picked = await pickAgentStandalone();
			if (picked != null) {
				// Reset the budget — a different agent gets a fresh allowance.
				await this.dispatch(picked, args);
			}
		}
	}
}
