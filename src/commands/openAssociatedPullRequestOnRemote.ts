import type { TextEditor, Uri } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand, getCommandUri } from './base';
import type { OpenPullRequestOnRemoteCommandArgs } from './openPullRequestOnRemote';

@command()
export class OpenAssociatedPullRequestOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.OpenAssociatedPullRequestOnRemote);
	}

	async execute(editor?: TextEditor, uri?: Uri) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		if (editor != null && gitUri != null) {
			const blameline = editor.selection.active.line;
			if (blameline < 0) return;

			try {
				const blame = await this.container.git.getBlameForLine(gitUri, blameline);
				if (blame == null) return;

				await executeCommand<OpenPullRequestOnRemoteCommandArgs>(Commands.OpenPullRequestOnRemote, {
					clipboard: false,
					ref: blame.commit.sha,
					repoPath: blame.commit.repoPath,
				});
			} catch (ex) {
				Logger.error(ex, 'OpenAssociatedPullRequestOnRemoteCommand', `getBlameForLine(${blameline})`);
			}

			return;
		}

		try {
			const repo = await getRepositoryOrShowPicker('Open Pull Request Associated', undefined, undefined, {
				filter: async r => (await this.container.git.getBestRemoteWithRichProvider(r.uri))?.provider != null,
			});
			if (repo == null) return;

			const remote = await this.container.git.getBestRemoteWithRichProvider(repo.uri);
			if (remote?.provider == null) return;

			const branch = await repo.getBranch();
			if (branch == null) return;

			let pr = await this.container.git.getPullRequestForBranch(branch.ref, remote.provider);
			if (pr == null) {
				const commit = await repo.getCommit('HEAD');
				if (commit == null) return;

				pr = await this.container.git.getPullRequestForCommit(commit.ref, remote.provider);
				if (pr == null) return;
			}

			await executeCommand<OpenPullRequestOnRemoteCommandArgs>(Commands.OpenPullRequestOnRemote, {
				pr: {
					url: pr.url,
				},
			});
		} catch (ex) {
			Logger.error(ex, 'OpenAssociatedPullRequestOnRemoteCommand', 'No editor opened');
		}
	}
}
