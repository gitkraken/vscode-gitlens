import slug from 'slug';
import { env, Uri } from 'vscode';
import type { SendToChatCommandArgs } from '../../../../commands/sendToChat.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { Container } from '../../../../container.js';
import { WorktreeCreateError } from '../../../../git/errors.js';
import type { GitBranch } from '../../../../git/models/branch.js';
import type { IssueShape } from '../../../../git/models/issue.js';
import type { GitWorktree } from '../../../../git/models/worktree.js';
import { addAssociatedIssueToBranch } from '../../../../git/utils/-webview/branch.issue.utils.js';
import { getOrOpenIssueRepository } from '../../../../git/utils/-webview/issue.utils.js';
import { serializeIssue } from '../../../../git/utils/issue.utils.js';
import { executeCommand } from '../../../../system/-webview/command.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { openWorkspace } from '../../../../system/-webview/vscode/workspaces.js';
import type { UriTypes } from '../../../../uris/deepLinks/deepLink.js';
import { DeepLinkCommandType, DeepLinkServiceState, DeepLinkType } from '../../../../uris/deepLinks/deepLink.js';
import { ensureFeatureAccess } from '../../../gk/utils/-webview/acount.utils.js';
import { getIssueOwner } from '../../../integrations/providers/utils.js';
import { getConnectedIntegrations } from '../../startWorkBase.js';

export function createBranchNameFromIssue(issue: IssueShape): string {
	return `${slug(issue.id, { lower: false })}-${slug(issue.title)}`;
}

export async function startWorkFromIssue(
	container: Container,
	options: { search: string; source?: Source },
): Promise<{ branch: GitBranch; worktree: GitWorktree }> {
	if (!(await ensureFeatureAccess(container, 'Start Work', 'startWork', options.source ?? { source: 'startWork' }))) {
		throw new Error('Feature access not granted');
	}

	if (!options.search) {
		throw new Error('No issue identifier provided');
	}

	const allConnectedIntegrations = await getConnectedIntegrations(container);
	const connectedIntegrations = [...allConnectedIntegrations.keys()].filter(integrationId =>
		Boolean(allConnectedIntegrations.get(integrationId)),
	);

	const allIssues = await container.integrations.getMyIssues(connectedIntegrations, { openRepositoriesOnly: true });
	const issue = allIssues?.find(i => i.url === options.search);
	if (!issue) {
		throw new Error(`No issue found for identifier: ${options.search}`);
	}

	// Get or open the repository for the issue
	const repo = await getOrOpenIssueRepository(container, issue, { promptIfNeeded: true });
	if (!repo) {
		throw new Error('Unable to find or open repository for issue');
	}

	// Generate branch name based on issue
	const branchName = `${slug(issue.id, { lower: false })}-${slug(issue.title)}`;

	// Get the default branch (main/master) to use as the base
	const defaultBranchName = await repo.git.branches.getDefaultBranchName();
	if (!defaultBranchName) {
		throw new Error('Unable to determine default branch');
	}

	// Create worktree with new branch from default branch
	const defaultUri = repo.git.worktrees?.getWorktreesDefaultUri();
	if (!defaultUri) {
		throw new Error('Unable to determine worktree location');
	}

	const worktreePath = Uri.joinPath(defaultUri, ...branchName.replace(/\\/g, '/').split('/'));

	let worktree: GitWorktree | undefined;
	try {
		worktree = await repo.git.worktrees?.createWorktreeWithResult(worktreePath.fsPath, {
			commitish: defaultBranchName,
			createBranch: branchName,
		});
	} catch (ex) {
		if (WorktreeCreateError.is(ex, 'alreadyCheckedOut')) {
			throw new Error(`Branch '${branchName}' is already checked out in another worktree`);
		}
		if (WorktreeCreateError.is(ex, 'alreadyExists')) {
			throw new Error(`Worktree path '${worktreePath.fsPath}' already exists`);
		}
		throw new Error(`Failed to create worktree: ${ex instanceof Error ? ex.message : String(ex)}`);
	}

	if (!worktree) {
		throw new Error(`Failed to create worktree for branch: ${branchName}`);
	}

	// Store deeplink and open the worktree in a new window
	await storeStartWorkDeepLink(container, issue, worktree.uri.fsPath);
	openWorkspace(worktree.uri, { location: 'newWindow' });
	// openWorkspace(worktree.uri);

	// Get the branch from the worktree repository
	const worktreeRepo = await container.git.getOrOpenRepository(worktree.uri);
	if (!worktreeRepo) {
		throw new Error('Failed to open worktree repository');
	}

	const worktreeBranch = await worktreeRepo.git.branches.getBranch(branchName);
	if (!worktreeBranch) {
		throw new Error(`Failed to get branch from worktree: ${branchName}`);
	}

	// Associate the issue with the branch
	const owner = getIssueOwner(issue);
	if (owner != null) {
		await addAssociatedIssueToBranch(container, worktreeBranch, { ...issue, type: 'issue' }, owner);
	}

	return { branch: worktreeBranch, worktree: worktree };
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

async function storeStartWorkDeepLink(container: Container, issue: IssueShape, repoPath: string): Promise<void> {
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
