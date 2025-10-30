import type { Uri } from 'vscode';
import { window } from 'vscode';
import type { Container } from '../../container';
import { create as createWorktree, open as openWorktree } from '../../git/actions/worktree';
import type { GitBranchReference } from '../../git/models/reference';
import type { GitRemote } from '../../git/models/remote';
import { parseGitRemoteUrl } from '../../git/parsers/remoteParser';
import { getReferenceFromBranch } from '../../git/utils/-webview/reference.utils';
import { getWorktreeForBranch } from '../../git/utils/-webview/worktree.utils';
import { createReference } from '../../git/utils/reference.utils';
import { command } from '../../system/-webview/command';
import { Logger } from '../../system/logger';
import { waitUntilNextTick } from '../../system/promise';
import { GlCommandBase } from '../commandBase';

interface GHPRPullRequestNode {
	readonly pullRequestModel: GHPRPullRequest;
}

export interface GHPRPullRequest {
	readonly base: {
		readonly repositoryCloneUrl: {
			readonly repositoryName: string;
			readonly owner: string;
			readonly url: Uri;
		};
	};
	readonly githubRepository: {
		readonly rootUri: Uri;
	};
	readonly head: {
		readonly ref: string;
		readonly sha: string;
		readonly repositoryCloneUrl: {
			readonly repositoryName: string;
			readonly owner: string;
			readonly url: Uri;
		};
	};

	readonly item: {
		readonly number: number;
	};
}

@command()
export class OpenOrCreateWorktreeCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.ghpr.views.openOrCreateWorktree');
	}

	async execute(...args: [GHPRPullRequestNode | GHPRPullRequest, ...unknown[]]): Promise<void> {
		const [arg] = args;
		let pr;
		if ('pullRequestModel' in arg) {
			pr = arg.pullRequestModel;
		} else {
			pr = arg;
		}

		const {
			base: {
				repositoryCloneUrl: { url: rootUri, owner: rootOwner, repositoryName: rootRepository },
			},
			githubRepository: { rootUri: localUri },
			head: {
				repositoryCloneUrl: { url: remoteUri, owner: remoteOwner },
				ref,
			},
			item: { number },
		} = pr;

		let repo = this.container.git.getRepository(localUri);
		if (repo == null) {
			void window.showWarningMessage(`Unable to find repository(${localUri.toString()}) for PR #${number}`);
			return;
		}

		repo = await repo.getCommonRepository();
		if (repo == null) {
			void window.showWarningMessage(`Unable to find main repository(${localUri.toString()}) for PR #${number}`);
			return;
		}

		const remoteUrl = remoteUri.toString();
		const [, remoteDomain, remotePath] = parseGitRemoteUrl(remoteUrl);

		const remotes = await repo.git.remotes.getRemotes({ filter: r => r.matches(remoteDomain, remotePath) });
		const remote = remotes[0] as GitRemote | undefined;

		let addRemote: { name: string; url: string } | undefined;
		let remoteName;
		if (remote != null) {
			remoteName = remote.name;
			// Ensure we have the latest from the remote
			await repo.git.ops?.fetch({ remote: remote.name });
		} else {
			remoteName = remoteOwner;
			addRemote = { name: remoteOwner, url: remoteUrl };
		}

		const remoteBranchName = `${remoteName}/${ref}`;
		const localBranchName = `pr/${rootUri.toString() === remoteUri.toString() ? ref : remoteBranchName}`;
		const qualifiedRemoteBranchName = `remotes/${remoteBranchName}`;

		const worktree = await getWorktreeForBranch(repo, localBranchName, remoteBranchName);
		if (worktree != null) {
			void openWorktree(worktree, { openOnly: true });
			return;
		}

		let branchRef: GitBranchReference;
		let createBranch: string | undefined;

		const localBranch = await repo.git.branches.getLocalBranchByUpstream?.(remoteBranchName);
		if (localBranch != null) {
			branchRef = getReferenceFromBranch(localBranch);
			// TODO@eamodio check if we are behind and if so ask the user to fast-forward
		} else {
			branchRef = createReference(qualifiedRemoteBranchName, repo.path, {
				refType: 'branch',
				name: qualifiedRemoteBranchName,
				remote: true,
			});
			createBranch = localBranchName;
		}

		await waitUntilNextTick();

		try {
			const worktree = await createWorktree(repo, undefined, branchRef, {
				addRemote: addRemote,
				createBranch: createBranch,
			});
			if (worktree == null) return;

			// Save the PR number in the branch config
			// https://github.com/Microsoft/vscode-pull-request-github/blob/0c556c48c69a3df2f9cf9a45ed2c40909791b8ab/src/github/pullRequestGitHelper.ts#L18
			void repo.git.config.setConfig?.(
				`branch.${localBranchName}.github-pr-owner-number`,
				`${rootOwner}#${rootRepository}#${number}`,
			);
		} catch (ex) {
			Logger.error(ex, 'CreateWorktreeCommand', 'Unable to create worktree');
			void window.showErrorMessage(`Unable to create worktree for ${remoteOwner}:${ref}`);
		}
	}
}
