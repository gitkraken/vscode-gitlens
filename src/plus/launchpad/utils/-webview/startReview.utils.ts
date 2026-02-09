import type { WorktreeGitCommandArgs } from '../../../../commands/git/worktree.js';
import type { OpenChatActionCommandArgs } from '../../../../commands/openChatAction.js';
import type { SendToChatCommandArgs } from '../../../../commands/sendToChat.js';
import type { Container } from '../../../../container.js';
import type { GitBranch } from '../../../../git/models/branch.js';
import type { PullRequest, PullRequestShape } from '../../../../git/models/pullRequest.js';
import type { GitBranchReference } from '../../../../git/models/reference.js';
import type { Repository } from '../../../../git/models/repository.js';
import type { GitWorktree } from '../../../../git/models/worktree.js';
import { parseGitRemoteUrl } from '../../../../git/parsers/remoteParser.js';
import { getOrOpenPullRequestRepository } from '../../../../git/utils/-webview/pullRequest.utils.js';
import { getReferenceFromBranch } from '../../../../git/utils/-webview/reference.utils.js';
import { getWorktreeForBranch } from '../../../../git/utils/-webview/worktree.utils.js';
import { serializePullRequest } from '../../../../git/utils/pullRequest.utils.js';
import { createReference } from '../../../../git/utils/reference.utils.js';
import { executeCommand } from '../../../../system/-webview/command.js';
import { openWorkspace } from '../../../../system/-webview/vscode/workspaces.js';
import { defer } from '../../../../system/promise.js';
import type { StartReviewChatAction } from '../../../chat/chatActions.js';
import { storeChatActionDeepLink } from '../../../chat/chatActions.js';
import type { LaunchpadItem } from '../../launchpadProvider.js';

export interface StartReviewResult {
	worktree?: GitWorktree;
	branch: GitBranch;
	pr: PullRequest;
}

/**
 * Start a review from a LaunchpadItem - uses already-fetched PR and repository data.
 * This is the preferred method when you already have a LaunchpadItem.
 */
export async function startReviewFromLaunchpadItem(
	container: Container,
	item: LaunchpadItem,
	instructions?: string,
	openChatOnComplete?: boolean,
	useDefaults?: boolean,
): Promise<StartReviewResult> {
	const pr = item.underlyingPullRequest;
	if (!pr) {
		throw new Error('Unable to retrieve PR details');
	}

	if (item.openRepository?.localBranch?.current) {
		if (openChatOnComplete) {
			void executeCommand('gitlens.openChatAction', {
				chatAction: { type: 'startReview', pr: serializePullRequest(pr), instructions: instructions },
			} as OpenChatActionCommandArgs);
		}

		// If the branch is already checked out in the open repository, just get the worktree if it exists
		const existingWorktree = await getWorktreeForBranch(
			item.openRepository.repo,
			item.openRepository.localBranch.name,
			`${pr.refs?.head?.owner}/${pr.refs?.head?.branch}`,
		);
		return {
			worktree: existingWorktree,
			branch: item.openRepository.localBranch,
			pr: pr,
		};
	}

	// Use the already-resolved repository from LaunchpadItem if available,
	// otherwise use getOpenedPullRequestRepo which handles finding/opening the repo
	const repo =
		item.openRepository?.repo ??
		(await getOrOpenPullRequestRepository(container, pr, {
			skipVirtual: true,
		}));

	if (!repo) {
		const repoName = `${pr.repository.owner}/${pr.repository.repo}`;
		throw new Error(`No local repository found for ${repoName}. Please clone the repository first.`);
	}

	// Setup remote and branch
	const { addRemote, localBranchName, remoteBranchName, branchRef, createBranch } = await setupPullRequestBranch(
		repo,
		pr,
	);

	// Check if worktree already exists
	let worktree = await getWorktreeForBranch(repo, localBranchName, remoteBranchName);
	if (worktree == null) {
		worktree = await createPullRequestWorktree(
			container,
			repo,
			localBranchName,
			branchRef,
			createBranch,
			addRemote,
			useDefaults,
			openChatOnComplete
				? { type: 'startReview', pr: serializePullRequest(pr), instructions: instructions }
				: undefined,
		);
	} else {
		// Worktree already exists - handle chat and workspace opening manually
		if (openChatOnComplete) {
			await storeChatActionDeepLink(
				container,
				{ type: 'startReview', pr: serializePullRequest(pr), instructions: instructions },
				worktree.uri.fsPath,
			);
		}
		openWorkspace(worktree.uri, { location: 'newWindow' });
	}

	// Get branch from worktree
	const worktreeBranch = await getBranchFromWorktree(container, worktree, localBranchName);

	return { worktree: worktree, branch: worktreeBranch, pr: pr };
}

async function setupPullRequestBranch(
	repo: Repository,
	pr: PullRequest,
): Promise<{
	remoteName: string;
	addRemote: { name: string; url: string } | undefined;
	localBranchName: string;
	remoteBranchName: string;
	branchRef: GitBranchReference;
	createBranch: string | undefined;
}> {
	const headRef = pr.refs?.head;
	if (!headRef) {
		throw new Error('PR head reference not found');
	}

	// Parse remote URL
	const remoteUrl = headRef.url;
	const [, remoteDomain, remotePath] = parseGitRemoteUrl(remoteUrl);

	// Check if remote exists
	const remotes = await repo.git.remotes.getRemotes({ filter: r => r.matches(remoteDomain, remotePath) });

	let remoteName: string;
	let addRemote: { name: string; url: string } | undefined;

	if (remotes.length > 0) {
		remoteName = remotes[0].name;
		// Fetch latest from remote
		await repo.git.ops?.fetch({ remote: remoteName });
	} else {
		// Add remote for fork
		remoteName = headRef.owner;
		addRemote = { name: remoteName, url: remoteUrl };
	}

	const remoteBranchName = `${remoteName}/${headRef.branch}`;
	let localBranchName = `pr/${pr.id}-${headRef.branch}`;

	// Check if local branch exists
	let branchRef: GitBranchReference;
	let createBranch: string | undefined;

	const localBranch = await repo.git.branches.getLocalBranchByUpstream?.(remoteBranchName);
	if (localBranch != null) {
		// Use the existing local branch name instead of the PR-prefixed name
		branchRef = getReferenceFromBranch(localBranch);
		localBranchName = localBranch.name;
	} else {
		// Use the remote branch as the reference to create from, but pass it as the commitish
		// rather than as a remote branch reference to avoid the worktree create command
		// overwriting our custom local branch name with the remote branch name
		branchRef = createReference(remoteBranchName, repo.path, {
			refType: 'branch',
			name: remoteBranchName,
			remote: false,
		});
		createBranch = localBranchName;
	}

	return {
		remoteName: remoteName,
		addRemote: addRemote,
		localBranchName: localBranchName,
		remoteBranchName: remoteBranchName,
		branchRef: branchRef,
		createBranch: createBranch,
	};
}

async function createPullRequestWorktree(
	_container: Container,
	repo: Repository,
	localBranchName: string,
	branchRef: GitBranchReference,
	createBranch: string | undefined,
	addRemote: { name: string; url: string } | undefined,
	useDefaults?: boolean,
	chatAction?: StartReviewChatAction,
): Promise<GitWorktree> {
	// Add remote if needed (for forks)
	if (addRemote != null) {
		await repo.git.remotes.addRemote?.(addRemote.name, addRemote.url, { fetch: true });
	}

	// Use WorktreeCreateGitCommand to create the worktree with consistent path calculation
	const worktreeResult = defer<GitWorktree | undefined>();

	void executeCommand<WorktreeGitCommandArgs>('gitlens.git.worktree', {
		command: 'worktree',
		confirm: useDefaults ? false : undefined,
		state: {
			subcommand: 'create',
			repo: repo,
			reference: branchRef,
			createBranch: createBranch,
			flags: createBranch ? ['-b'] : [],
			worktreeDefaultOpen: useDefaults ? 'new' : undefined,
			result: worktreeResult,
			chatAction: chatAction,
		},
	});

	const worktree = await worktreeResult.promise;
	if (!worktree) {
		throw new Error(`Failed to create worktree for branch: ${localBranchName}`);
	}

	return worktree;
}

async function getBranchFromWorktree(
	container: Container,
	worktree: GitWorktree,
	branchName: string,
): Promise<GitBranch> {
	// Get the branch from the worktree repository
	const worktreeRepo = await container.git.getOrOpenRepository(worktree.uri);
	if (!worktreeRepo) {
		throw new Error('Failed to open worktree repository');
	}

	const worktreeBranch = await worktreeRepo.git.branches.getBranch(branchName);
	if (!worktreeBranch) {
		throw new Error(`Failed to get branch from worktree: ${branchName}`);
	}

	return worktreeBranch;
}

export async function startReviewInChat(
	container: Container,
	pr: PullRequestShape,
	instructions?: string,
): Promise<void> {
	const { prompt } = await container.ai.getPrompt('start-review-pullRequest', undefined, {
		prData: JSON.stringify(pr),
		instructions: instructions,
	});

	return executeCommand('gitlens.sendToChat', {
		query: prompt,
		execute: true,
	} as SendToChatCommandArgs) as Promise<void>;
}
