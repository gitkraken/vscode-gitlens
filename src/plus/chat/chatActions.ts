import { env } from 'vscode';
import type { SendToChatCommandArgs } from '../../commands/sendToChat.js';
import type { Sources } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import type { IssueShape } from '../../git/models/issue.js';
import type { PullRequestShape } from '../../git/models/pullRequest.js';
import { serializeIssue } from '../../git/utils/issue.utils.js';
import { executeCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import { Logger } from '../../system/logger.js';
import type { UriTypes } from '../../uris/deepLinks/deepLink.js';
import { DeepLinkCommandType, DeepLinkServiceState, DeepLinkType } from '../../uris/deepLinks/deepLink.js';

export interface StartWorkChatAction {
	type: 'startWork';
	issue: IssueShape;
	instructions?: string;
}

export interface StartReviewChatAction {
	type: 'startReview';
	pr: PullRequestShape;
	instructions?: string;
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

	if (promptToSend != null) {
		// Track MCP chat interaction usage
		void container.usage.track('action:gitlens.mcp.chatInteraction:happened');

		return executeCommand('gitlens.sendToChat', {
			query: promptToSend,
			execute: true,
			source: source,
		} as SendToChatCommandArgs) as Promise<void>;
	}
}

export async function storeChatActionDeepLink(
	container: Container,
	chatAction: ChatActions,
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
			state: deepLinkState,
		}),
	);
}
