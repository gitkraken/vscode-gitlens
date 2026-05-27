import { env } from 'vscode';
import type { IssueShape } from '@gitlens/git/models/issue.js';
import type { PullRequestShape } from '@gitlens/git/models/pullRequest.js';
import { serializeIssue } from '@gitlens/git/utils/issue.utils.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { RunPromptInAgentCommandArgs } from '../../commands/runPromptInAgent.js';
import type { SendToChatCommandArgs } from '../../commands/sendToChat.js';
import type { Sources } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { executeCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { UriTypes } from '../../uris/deepLinks/deepLink.js';
import { DeepLinkCommandType, DeepLinkServiceState, DeepLinkType } from '../../uris/deepLinks/deepLink.js';
import type { AgentDescriptor } from '../agents/agentDescriptor.js';
import { resolveDefaultAgent } from '../agents/agentRegistry.js';

export interface StartWorkChatAction {
	type: 'startWork';
	issue: IssueShape;
	instructions?: string;
	/** When set, dispatch via `gitlens.runPromptInAgent` instead of the host IDE-chat path. */
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

export type ChatActions = StartWorkChatAction | StartReviewChatAction;

export async function executeChatAction(
	container: Container,
	chatAction: ChatActions,
	source?: Sources,
): Promise<void> {
	let promptToSend: string | undefined;

	try {
		if (chatAction.type === 'startWork') {
			const { prompt } = await container.ai.getPrompt('start-work-issue', undefined, {
				issue: JSON.stringify(chatAction.issue),
				instructions: chatAction.instructions,
			});
			promptToSend = prompt;
		} else if (chatAction.type === 'startReview') {
			const { prompt } = await container.ai.getPrompt('start-review-pullRequest', undefined, {
				prData: JSON.stringify(chatAction.pr),
				instructions: chatAction.instructions,
			});
			promptToSend = prompt;
		}
	} catch (ex) {
		Logger.error(ex, 'ChatActions', 'executeChatAction');
	}

	if (promptToSend == null) return;

	// Track MCP chat interaction usage
	void container.usage.track('action:gitlens.ai.openInAgent:happened');

	if (chatAction.agent != null) {
		await executeCommand('gitlens.runPromptInAgent', {
			prompt: promptToSend,
			cwd: chatAction.worktreePath,
			agent: chatAction.agent,
			source: source,
		} as RunPromptInAgentCommandArgs);
		return;
	}

	// startWork/startReview prompts are self-contained task instructions — auto-submit on Copilot.
	return executeCommand('gitlens.sendToChat', {
		query: promptToSend,
		execute: true,
		source: source,
	} as SendToChatCommandArgs);
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
