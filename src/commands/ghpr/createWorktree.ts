import type { Uri } from 'vscode';
import { window } from 'vscode';
import { Commands } from '../../constants';
import type { Container } from '../../container';
import { GitReference } from '../../git/models/reference';
import type { GitRemote } from '../../git/models/remote';
import { Logger } from '../../logger';
import { command } from '../../system/command';
import { waitUntilNextTick } from '../../system/promise';
import { Command } from '../base';
import { GitActions } from '../gitCommands.actions';

interface PullRequestNode {
	readonly pullRequestModel: PullRequest;
}

interface PullRequest {
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
export class CreateWorktreeCommand extends Command {
	constructor(private readonly container: Container) {
		super(Commands.CreateWorktreeForGHPR);
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
			githubRepository: { rootUri },
			head: {
				repositoryCloneUrl: { url: remoteUri, owner: remoteOwner },
				ref,
			},
		} = pr;

		let repo = this.container.git.getRepository(rootUri);
		if (repo == null) {
			void window.showWarningMessage(
				`Unable to find repository(${rootUri.toString()}) for PR #${pr.item.number}`,
			);
			return;
		}

		repo = await repo.getMainRepository();
		if (repo == null) {
			void window.showWarningMessage(
				`Unable to find main repository(${rootUri.toString()}) for PR #${pr.item.number}`,
			);
			return;
		}

		const remoteUrl = remoteUri.toString();

		let remote: GitRemote | undefined;
		[remote] = await repo.getRemotes({ filter: r => r.url === remoteUrl });
		if (remote == null) {
			await GitActions.Remote.add(repo, remoteOwner, remoteUrl, { fetch: true });
			[remote] = await repo.getRemotes({ filter: r => r.url === remoteUrl });
			if (remote == null) return;
		} else {
			await this.container.git.fetch(repo.path, { remote: remote.name });
		}

		await waitUntilNextTick();

		try {
			await GitActions.Worktree.create(
				repo,
				undefined,
				GitReference.create(`${remote.name}/${ref}`, repo.path, {
					refType: 'branch',
					name: `${remote.name}/${ref}`,
					remote: true,
				}),
			);
		} catch (ex) {
			Logger.error(ex, 'CreateWorktreeCommand', 'Unable to create worktree');
			void window.showErrorMessage(`Unable to create worktree for ${ref}`);
		}
	}
}
