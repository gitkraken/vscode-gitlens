import { Uri } from 'vscode';
import type { Container } from '../../../../container.js';
import { WorktreeCreateError } from '../../../../git/errors.js';
import type { GitBranch } from '../../../../git/models/branch.js';
import type { PullRequest } from '../../../../git/models/pullRequest.js';
import type { GitBranchReference } from '../../../../git/models/reference.js';
import type { Repository } from '../../../../git/models/repository.js';
import type { GitWorktree } from '../../../../git/models/worktree.js';
import { parseGitRemoteUrl } from '../../../../git/parsers/remoteParser.js';
import { getReferenceFromBranch } from '../../../../git/utils/-webview/reference.utils.js';
import { getWorktreeForBranch } from '../../../../git/utils/-webview/worktree.utils.js';
import { getRepositoryIdentityForPullRequest } from '../../../../git/utils/pullRequest.utils.js';
import { createReference } from '../../../../git/utils/reference.utils.js';
import { openWorkspace } from '../../../../system/-webview/vscode/workspaces.js';

export async function startReviewFromPullRequest(
	container: Container,
	prUrl: string,
): Promise<{
	worktree: GitWorktree;
	branch: GitBranch;
	pr: PullRequest;
}> {
	// Step 1: Fetch PR details using Launchpad
	const hasConnectedIntegration = await container.launchpad.hasConnectedIntegration();
	if (!hasConnectedIntegration) {
		throw new Error('No connected integrations. Please connect a GitHub, GitLab, or other integration first.');
	}

	const result = await container.launchpad.getCategorizedItems({ search: prUrl });
	if (result.error != null) {
		throw new Error(`Error fetching PR: ${result.error.message}`);
	}

	const items = result.items;
	if (items == null || items.length === 0) {
		throw new Error(`No PR found matching '${prUrl}'`);
	}

	const prItem = items[0];
	const pr = prItem.underlyingPullRequest;
	if (!pr) {
		throw new Error('Unable to retrieve PR details');
	}

	// Step 2: Find matching repository
	const repo = await findMatchingRepository(container, pr);
	if (!repo) {
		const repoName = `${pr.repository.owner}/${pr.repository.repo}`;
		throw new Error(`No local repository found for ${repoName}. Please clone the repository first.`);
	}

	// Step 3: Setup remote and branch
	const { addRemote, localBranchName, remoteBranchName, branchRef, createBranch } = await setupPullRequestBranch(
		repo,
		pr,
	);

	// Step 4: Check if worktree already exists
	const existingWorktree = await getWorktreeForBranch(repo, localBranchName, remoteBranchName);
	if (existingWorktree != null) {
		// Worktree already exists, just open it
		openWorkspace(existingWorktree.uri, { location: 'newWindow' });

		const worktreeBranch = await getBranchFromWorktree(container, existingWorktree, localBranchName);
		return { worktree: existingWorktree, branch: worktreeBranch, pr: pr };
	}

	// Step 5: Create new worktree
	const worktree = await createPullRequestWorktree(repo, localBranchName, branchRef, createBranch, addRemote);

	// Step 6: Open worktree in new window
	openWorkspace(worktree.uri, { location: 'newWindow' });

	// Step 7: Get branch from worktree
	const worktreeBranch = await getBranchFromWorktree(container, worktree, localBranchName);

	return { worktree: worktree, branch: worktreeBranch, pr: pr };
}

async function findMatchingRepository(container: Container, pr: PullRequest): Promise<Repository | undefined> {
	const repoIdentity = getRepositoryIdentityForPullRequest(pr, false);

	// Search through open repositories for a matching remote
	for (const repo of container.git.openRepositories) {
		const remotes = await repo.git.remotes.getRemotes();
		for (const remote of remotes) {
			// Check if remote URL matches the PR's repository
			if (
				remote.url.includes(repoIdentity.name) ||
				remote.url.includes(`${pr.repository.owner}/${pr.repository.repo}`)
			) {
				return (await repo.getCommonRepository()) ?? repo;
			}
		}
	}

	return undefined;
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
	const localBranchName = `pr/${pr.id}-${headRef.branch}`;
	const qualifiedRemoteBranchName = `remotes/${remoteBranchName}`;

	// Check if local branch exists
	let branchRef: GitBranchReference;
	let createBranch: string | undefined;

	const localBranch = await repo.git.branches.getLocalBranchByUpstream?.(remoteBranchName);
	if (localBranch != null) {
		branchRef = getReferenceFromBranch(localBranch);
	} else {
		// Create from remote branch
		branchRef = createReference(qualifiedRemoteBranchName, repo.path, {
			refType: 'branch',
			name: qualifiedRemoteBranchName,
			remote: true,
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
	repo: Repository,
	localBranchName: string,
	branchRef: GitBranchReference,
	createBranch: string | undefined,
	addRemote: { name: string; url: string } | undefined,
): Promise<GitWorktree> {
	const defaultUri = repo.git.worktrees?.getWorktreesDefaultUri();
	if (!defaultUri) {
		throw new Error('Unable to determine worktree location');
	}

	const worktreePath = Uri.joinPath(defaultUri, ...localBranchName.replace(/\\/g, '/').split('/'));

	try {
		// Add remote if needed (for forks)
		if (addRemote != null) {
			await repo.git.remotes.addRemote?.(addRemote.name, addRemote.url, { fetch: true });
		}

		// Create worktree
		const worktree = await repo.git.worktrees?.createWorktreeWithResult(worktreePath.fsPath, {
			commitish: branchRef.ref,
			createBranch: createBranch,
		});

		if (!worktree) {
			throw new Error(`Failed to create worktree for branch: ${localBranchName}`);
		}

		return worktree;
	} catch (ex) {
		if (WorktreeCreateError.is(ex, 'alreadyCheckedOut')) {
			throw new Error(`Branch '${localBranchName}' is already checked out in another worktree`);
		}
		if (WorktreeCreateError.is(ex, 'alreadyExists')) {
			throw new Error(`Worktree path '${worktreePath.fsPath}' already exists`);
		}
		throw ex;
	}
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
