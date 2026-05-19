import { env, window } from 'vscode';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { serializeIssue } from '@gitlens/git/utils/issue.utils.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { SendToChatCommandArgs } from '../../commands/sendToChat.js';
import type { Sources } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { executeCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { UriTypes } from '../../uris/deepLinks/deepLink.js';
import { DeepLinkCommandType, DeepLinkServiceState, DeepLinkType } from '../../uris/deepLinks/deepLink.js';
import type { AgentDescriptor } from '../agents/agentDescriptor.js';
import { runAgent } from '../agents/agentDispatch.js';
import { pickAgentStandalone } from '../agents/agentPicker.js';
import { resolveDefaultAgent } from '../agents/agentRegistry.js';

export interface StartWorkChatAction {
	type: 'startWork';
	issue: IssueShape;
	instructions?: string;
	/** When set, dispatch via {@link runAgent} instead of the host IDE-chat path. */
	agent?: AgentDescriptor;
	/** The new worktree path (used as `cwd` for CLI dispatch). Plumbed explicitly because
	 *  `workspace.workspaceFolders[0]` may not be the worktree in multi-root workspaces. */
	worktreePath?: string;
}

export interface StartReviewChatAction {
	type: 'startReview';
	pr: PullRequestShape;
	instructions?: string;
	agent?: AgentDescriptor;
	worktreePath?: string;
}

export interface AddressReviewFindingsChatAction {
	type: 'addressReviewFindings';
	scopeLabel: string;
	reviewMarkdown: string;
	granularity: 'review' | 'focusArea' | 'finding';
	instructions?: string;
}

export type ChatActions = StartWorkChatAction | StartReviewChatAction | AddressReviewFindingsChatAction;

export async function executeChatAction(
	container: Container,
	chatAction: ChatActions,
	source?: Sources,
): Promise<void> {
	let promptToSend: string | undefined;
	let mode: SendToChatCommandArgs['mode'];
	let execute = true;
	let promptKey: 'start-work-issue' | 'start-review-pullRequest' | 'address-review-findings' | undefined;

	try {
		if (chatAction.type === 'startWork') {
			const { prompt } = await container.ai.getPrompt('start-work-issue', undefined, {
				issue: JSON.stringify(chatAction.issue),
				instructions: chatAction.instructions,
			});
			promptToSend = prompt;
			promptKey = 'start-work-issue';
		} else if (chatAction.type === 'startReview') {
			const { prompt } = await container.ai.getPrompt('start-review-pullRequest', undefined, {
				prData: JSON.stringify(chatAction.pr),
				instructions: chatAction.instructions,
			});
			promptToSend = prompt;
			promptKey = 'start-review-pullRequest';
		} else if (chatAction.type === 'addressReviewFindings') {
			const { prompt } = await container.ai.getPrompt('address-review-findings', undefined, {
				reviewMarkdown: chatAction.reviewMarkdown,
				scopeLabel: chatAction.scopeLabel,
				granularity: chatAction.granularity,
				instructions: chatAction.instructions,
			});
			promptToSend = prompt;
			promptKey = 'address-review-findings';
			mode = 'agent';
			// Review-level is a conversational opener (let the user choose where to start);
			// area- and finding-level are self-contained tasks that should auto-execute.
			execute = chatAction.granularity !== 'review';
		}
	} catch (ex) {
		Logger.error(ex, 'ChatActions', 'executeChatAction');
	}

	if (promptToSend == null) return;

	// Track MCP chat interaction usage
	void container.usage.track('action:gitlens.mcp.chatInteraction:happened');
	if (chatAction.type === 'addressReviewFindings') {
		void container.usage.track('action:gitlens.ai.review.sentToChat:happened');
	}

	// New path: when an agent descriptor is plumbed through, dispatch via runAgent.
	// Legacy path: fall back to the existing host IDE-chat hand-off via gitlens.sendToChat.
	if ((chatAction.type === 'startWork' || chatAction.type === 'startReview') && chatAction.agent != null) {
		await dispatchToAgent(container, chatAction, promptToSend, promptKey);
		return;
	}

	return executeCommand('gitlens.sendToChat', {
		query: promptToSend,
		execute: execute,
		mode: mode,
		source: source,
	} as SendToChatCommandArgs);
}

async function dispatchToAgent(
	container: Container,
	chatAction: StartWorkChatAction | StartReviewChatAction,
	prompt: string,
	promptKey: string | undefined,
): Promise<void> {
	const descriptor = chatAction.agent!;
	const cwd = chatAction.worktreePath;

	const result = await runAgent(descriptor, prompt, { cwd: cwd });
	if (result.success) return;

	// Dispatch failed. Telemetry + toast with [Retry] [Pick another agent].
	void container.usage.track('action:gitlens.ai.openInAgent.dispatchFailed:happened');
	Logger.error(
		result.error ?? new Error('Unknown dispatch failure'),
		'ChatActions',
		`dispatchToAgent kind=${descriptor.kind} agentId=${descriptor.id} promptKey=${promptKey ?? '?'}`,
	);

	const retryAction = 'Retry';
	const pickAnotherAction = 'Pick another agent';
	const choice = await window.showWarningMessage(
		`Couldn't reach ${descriptor.label}. ${result.clipboardCopiedAsFallback ? 'Prompt copied to clipboard.' : ''}`.trim(),
		retryAction,
		pickAnotherAction,
	);

	if (choice === retryAction) {
		await dispatchToAgent(container, chatAction, prompt, promptKey);
		return;
	}

	if (choice === pickAnotherAction) {
		const picked = await pickAgentStandalone();
		if (picked != null) {
			const updated: StartWorkChatAction | StartReviewChatAction = { ...chatAction, agent: picked };
			await dispatchToAgent(container, updated, prompt, promptKey);
		}
	}
}

/** Resolves a stored `defaultAgent` setting value to a live descriptor at dispatch time.
 *  Centralizes the lookup so callers don't have to import `agentRegistry` directly. */
export async function resolveDefaultAgentDescriptor(
	id: string | null | undefined,
): Promise<AgentDescriptor | undefined> {
	if (id == null) return undefined;
	return resolveDefaultAgent(id);
}

export async function storeChatActionDeepLink(
	container: Container,
	chatAction: StartWorkChatAction | StartReviewChatAction,
	repoPath: string,
): Promise<void> {
	const schemeOverride = configuration.get('deepLinks.schemeOverride');
	const scheme = typeof schemeOverride === 'string' ? schemeOverride : env.uriScheme;

	const deepLinkCommandType =
		chatAction.type === 'startWork' ? DeepLinkCommandType.StartWork : DeepLinkCommandType.StartReview;
	const deepLinkState =
		chatAction.type === 'startWork' ? DeepLinkServiceState.StartWork : DeepLinkServiceState.StartReview;

	const deepLinkUrl = new URL(
		`${scheme}://${container.context.extension.id}/${'link' satisfies UriTypes}/${DeepLinkType.Command}/${deepLinkCommandType}`,
	);

	const contextData =
		chatAction.type === 'startWork'
			? { issueData: JSON.stringify(serializeIssue(chatAction.issue)) }
			: { prData: JSON.stringify(chatAction.pr) };

	await container.storage.storeSecret(
		'deepLinks:pending',
		JSON.stringify({
			url: deepLinkUrl.toString(),
			repoPath: repoPath,
			...contextData,
			instructions: chatAction.instructions,
			// Persist the agent descriptor and worktree path so the new window's deep-link resume
			// can reconstruct the chatAction and dispatch via runAgent.
			agent: chatAction.agent,
			worktreePath: chatAction.worktreePath ?? repoPath,
			state: deepLinkState,
		}),
	);
}
