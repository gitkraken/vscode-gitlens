import type { Uri } from 'vscode';
import { window } from 'vscode';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import { add as addRemote } from '../../git/actions/remote';
import { create as createWorktree, open as openWorktree } from '../../git/actions/worktree';
import { createReference } from '../../git/models/reference';
import type { GitRemote } from '../../git/models/remote';
import { parseGitRemoteUrl } from '../../git/parsers/remoteParser';
import { command } from '../../system/command';
import { Logger } from '../../system/logger';
import { waitUntilNextTick } from '../../system/promise';
import { Command } from '../base';

interface PullRequestNode {
	readonly pullRequestModel: PullRequest;
}

interface PullRequest {
	readonly base: {
		readonly repositoryCloneUrl: {
			readonly owner: string;
			readonly repositoryName: string;
		};
	};
	readonly githubRepository: {
		readonly rootUri: Uri;
	};
	readonly head: {
		readonly ref: string;
		readonly sha: string;
		readonly repositoryCloneUrl: {
			readonly owner: string;
			readonly url: Uri;
		};
	};

	readonly item: {
		readonly number: number;
	};
}

@command()
export class OpenOrCreateWorktreeCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.OpenOrCreateWorktreeForGHPR);
	}

	async execute(...args: [PullRequestNode | PullRequest, ...unknown[]]) {
		const [arg] = args;
		let pr;
		if ('pullRequestModel' in arg) {
			pr = arg.pullRequestModel;
		} else {
			pr = arg;
		}

		const {
			base: {
				repositoryCloneUrl: { owner: rootOwner, repositoryName: rootRepository },
			},
			githubRepository: { rootUri },
			head: {
				repositoryCloneUrl: { url: remoteUri, owner: remoteOwner },
				ref,
			},
			item: { number },
		} = pr;

		let repo = this.container.git.getRepository(rootUri);
		if (repo == null) {
			void window.showWarningMessage(`Unable to find repository(${rootUri.toString()}) for PR #${number}`);
			return;
		}

		repo = await repo.getMainRepository();
		if (repo == null) {
			void window.showWarningMessage(`Unable to find main repository(${rootUri.toString()}) for PR #${number}`);
			return;
		}

		const worktrees = await repo.getWorktrees();
		const worktree = worktrees.find(w => w.branch === ref);
		if (worktree != null) {
			void openWorktree(worktree);

			return;
		}

		const remoteUrl = remoteUri.toString();
		const [, remoteDomain, remotePath] = parseGitRemoteUrl(remoteUrl);

		let remote: GitRemote | undefined;
		[remote] = await repo.getRemotes({ filter: r => r.matches(remoteDomain, remotePath) });
		if (remote == null) {
			const result = await window.showInformationMessage(
				`Unable to find a remote for '${remoteUrl}'. Would you like to add a new remote?`,
				{ modal: true },
				{ title: 'Yes' },
				{ title: 'No', isCloseAffordance: true },
			);
			if (result?.title !== 'Yes') return;

			await addRemote(repo, remoteOwner, remoteUrl, {
				confirm: false,
				fetch: true,
				reveal: false,
			});
			[remote] = await repo.getRemotes({ filter: r => r.url === remoteUrl });
			if (remote == null) return;
		} else {
			await this.container.git.fetch(repo.path, { remote: remote.name });
		}

		await waitUntilNextTick();

		try {
			await createWorktree(
				repo,
				undefined,
				createReference(`${remote.name}/${ref}`, repo.path, {
					refType: 'branch',
					name: `${remote.name}/${ref}`,
					remote: true,
				}),
			);

			// Ensure that the worktree was created
			const worktree = await this.container.git.getWorktree(repo.path, w => w.branch === ref);
			if (worktree == null) return;

			// Save the PR number in the branch config
			// https://github.com/Microsoft/vscode-pull-request-github/blob/0c556c48c69a3df2f9cf9a45ed2c40909791b8ab/src/github/pullRequestGitHelper.ts#L18
			void this.container.git.setConfig(
				repo.path,
				`branch.${ref}.github-pr-owner-number`,
				`${rootOwner}#${rootRepository}#${number}`,
			);
		} catch (ex) {
			Logger.error(ex, 'CreateWorktreeCommand', 'Unable to create worktree');
			void window.showErrorMessage(`Unable to create worktree for ${ref}`);
		}
	}
}
