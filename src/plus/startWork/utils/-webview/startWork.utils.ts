import slug from 'slug';
import { env } from 'vscode';
import type { SendToChatCommandArgs } from '../../../../commands/sendToChat.js';
import type { Container } from '../../../../container.js';
import type { IssueShape } from '../../../../git/models/issue.js';
import { serializeIssue } from '../../../../git/utils/issue.utils.js';
import { executeCommand } from '../../../../system/-webview/command.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import type { UriTypes } from '../../../../uris/deepLinks/deepLink.js';
import { DeepLinkCommandType, DeepLinkServiceState, DeepLinkType } from '../../../../uris/deepLinks/deepLink.js';

export function createBranchNameFromIssue(issue: IssueShape): string {
	return `${slug(issue.id, { lower: false })}-${slug(issue.title)}`;
}

export async function startWorkInChat(container: Container, issue: IssueShape): Promise<void> {
	const { prompt } = await container.ai.getPrompt('start-work-issue', undefined, {
		issue: JSON.stringify(issue),
	});

	return executeCommand('gitlens.sendToChat', {
		query: prompt,
		execute: true,
	} as SendToChatCommandArgs) as Promise<void>;
}

export async function storeStartWorkDeepLink(container: Container, issue: IssueShape, repoPath: string): Promise<void> {
	const schemeOverride = configuration.get('deepLinks.schemeOverride');
	const scheme = typeof schemeOverride === 'string' ? schemeOverride : env.uriScheme;

	const deepLinkUrl = new URL(
		`${scheme}://${container.context.extension.id}/${'link' satisfies UriTypes}/${
			DeepLinkType.Command
		}/${DeepLinkCommandType.StartWork}`,
	);

	await container.storage.storeSecret(
		'deepLinks:pending',
		JSON.stringify({
			url: deepLinkUrl.toString(),
			repoPath: repoPath,
			issueData: JSON.stringify(serializeIssue(issue)),
			state: DeepLinkServiceState.StartWork,
		}),
	);
}
