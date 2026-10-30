import { l10n, window } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import type { Sources } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import type { AgentDescriptor } from '../plus/agents/agentDescriptor.js';
import { getLiveCliSessionAgent, runAgent } from '../plus/agents/agentDispatch.js';
import { pickAgentStandalone, resolveDefaultAgentOrNotify } from '../plus/agents/agentPicker.js';
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
	/** CLI agents only: keep the CLI session under this key and send a later prompt with the same key
	 *  into it as the next turn (see `RunAgentOptions.session`) — while it runs, with no agent to choose. */
	session?: string;
	/** Keep the outcome pending while a failed dispatch's Retry / Pick another agent toast is up, and report
	 *  how that second attempt went. Off by default: the toast can sit in the notification center for as long
	 *  as the user leaves it, so `failed` comes back at once and a later Retry runs on its own. For a caller
	 *  whose setup (a report channel) the retried prompt still needs — it must not be torn down meanwhile. */
	waitForRetry?: boolean;
	/** With `waitForRetry`: told `true` when a failed dispatch's Retry / Pick another agent toast goes up, and
	 *  `false` when the user takes it up and the prompt is on its way again — so the caller can say, while it
	 *  waits, that no agent has the prompt yet. Dismissing the toast ends in a `failed` outcome instead. */
	onRetryOffer?: (offered: boolean) => void;
}

/** How a {@link RunPromptInAgentCommand} ended: the prompt reached an agent, the user backed out of the
 *  picker, or the dispatch failed (the command has already said so in a toast — without `waitForRetry`, a
 *  Retry from that toast may still get it through later). A caller that set something up for the agent — a
 *  report channel — passes `waitForRetry` and tears it down on anything but `dispatched`. */
export type RunPromptInAgentOutcome = 'dispatched' | 'cancelled' | 'failed';

/** Runs an already-rendered prompt in an agent (IDE chat, Claude extension, or detected CLI).
 *  Resolves the descriptor as `args.agent` > the agent of the live `args.session` > persisted
 *  `gitlens.ai.defaultAgent` > picker. */
@command()
export class RunPromptInAgentCommand extends GlCommandBase {
	private static readonly maxRetries = 2;

	constructor(private readonly container: Container) {
		// Callers act on the outcome (Review in Repo keeps or closes its channel by it), so it must come back
		super('gitlens.runPromptInAgent', undefined, { returnResult: true });
	}

	async execute(args?: RunPromptInAgentCommandArgs): Promise<RunPromptInAgentOutcome> {
		if (!args?.prompt) {
			throw new Error('Prompt is required for runPromptInAgent command');
		}

		const descriptor = await this.resolveAgent(args.agent, args.session);
		if (descriptor == null) return 'cancelled';

		return this.dispatch(descriptor, args);
	}

	private async resolveAgent(
		preselected: AgentDescriptor | undefined,
		session: string | undefined,
	): Promise<AgentDescriptor | undefined> {
		if (preselected != null) return preselected;

		// A session still running takes the prompt as its next turn — its agent was chosen when it started
		const running = session != null ? getLiveCliSessionAgent(session) : undefined;
		if (running != null) return running;

		// `resolveDefaultAgentOrNotify` returns only descriptors that pass the supported-agents filter,
		// so no extra availability check is needed here — `runAgent` re-validates at dispatch time.
		const persistedId = configuration.get('ai.defaultAgent') ?? undefined;
		if (persistedId != null) {
			const descriptor = await resolveDefaultAgentOrNotify(this.container, persistedId);
			if (descriptor != null) return descriptor;
		}

		return pickAgentStandalone(this.container);
	}

	private async dispatch(
		descriptor: AgentDescriptor,
		args: RunPromptInAgentCommandArgs,
		retries = 0,
	): Promise<RunPromptInAgentOutcome> {
		const result = await runAgent(descriptor, args.prompt, {
			cwd: args.cwd,
			autoExecute: args.autoExecute,
			mode: args.mode,
			session: args.session,
		});
		if (result.success) return 'dispatched';

		void this.container.usage.track('action:gitlens.ai.openInAgent.dispatchFailed:happened');
		Logger.error(
			result.error ?? new Error('Unknown dispatch failure'),
			'RunPromptInAgent',
			`dispatch kind=${descriptor.kind} agentId=${descriptor.id} source=${args.source ?? '?'} retries=${retries}`,
		);

		const retried = this.offerRetry(descriptor, args, retries, result.clipboardCopiedAsFallback === true);
		if (args.waitForRetry) return retried;

		// Nobody waits on the toast: a Retry from it shows its own failure, so only a throw is left to log
		void retried.catch((ex: unknown) => Logger.error(ex, 'RunPromptInAgent', 'retry'));
		return 'failed';
	}

	private async offerRetry(
		descriptor: AgentDescriptor,
		args: RunPromptInAgentCommandArgs,
		retries: number,
		copiedToClipboard: boolean,
	): Promise<RunPromptInAgentOutcome> {
		// Cap Retry after `maxRetries` attempts so a misconfigured agent can't trap the user
		// in a retry loop (every CLI retry spawns a fresh terminal). "Pick another agent"
		// and dismissing the toast both remain as escapes.
		const retryAction = l10n.t('Retry');
		const pickAnotherAction = l10n.t('Pick another agent');
		const canRetry = retries < RunPromptInAgentCommand.maxRetries;
		const actions = canRetry ? [retryAction, pickAnotherAction] : [pickAnotherAction];

		const message = copiedToClipboard
			? l10n.t("Couldn't reach {0}. Prompt copied to clipboard.", descriptor.label)
			: l10n.t("Couldn't reach {0}.", descriptor.label);
		// Only a caller still waiting on the outcome can act on the offer — see `onRetryOffer`
		const onRetryOffer = args.waitForRetry ? args.onRetryOffer : undefined;
		onRetryOffer?.(true);
		const choice = await window.showWarningMessage(message, ...actions);

		if (choice === retryAction) {
			onRetryOffer?.(false);
			return this.dispatch(descriptor, args, retries + 1);
		}

		if (choice === pickAnotherAction) {
			const picked = await pickAgentStandalone(this.container);
			// Reset the budget — a different agent gets a fresh allowance.
			if (picked != null) {
				onRetryOffer?.(false);
				return this.dispatch(picked, args);
			}
		}

		return 'failed';
	}
}
