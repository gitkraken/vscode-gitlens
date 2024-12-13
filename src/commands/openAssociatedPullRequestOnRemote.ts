import type { TextEditor, Uri } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { Logger } from '../system/logger';
import { command, executeCommand } from '../system/vscode/command';
import { ActiveEditorCommand, getCommandUri } from './base';
import type { OpenPullRequestOnRemoteCommandArgs } from './openPullRequestOnRemote';

@command()
export class OpenAssociatedPullRequestOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(GlCommand.OpenAssociatedPullRequestOnRemote);
	}

	async execute(editor?: TextEditor, uri?: Uri) {
		uri = getCommandUri(uri, editor);

		const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;

		let args: OpenPullRequestOnRemoteCommandArgs;
		if (editor != null && gitUri != null) {
			const blameline = editor.selection.active.line;
			if (blameline < 0) return;

			try {
				const blame = await this.container.git.getBlameForLine(gitUri, blameline);
				if (blame == null) return;

				args = { clipboard: false, ref: blame.commit.sha, repoPath: blame.commit.repoPath };
			} catch (ex) {
				Logger.error(ex, 'OpenAssociatedPullRequestOnRemoteCommand', `getBlameForLine(${blameline})`);
				return;
			}
		} else {
			try {
				const repo = await getRepositoryOrShowPicker('Open Associated Pull Request', undefined, undefined, {
					filter: async r => (await this.container.git.getBestRemoteWithIntegration(r.uri)) != null,
				});
				if (repo == null) return;

				const branch = await repo?.git.getBranch();
				const pr = await branch?.getAssociatedPullRequest({ expiryOverride: true });

				args =
					pr != null
						? { clipboard: false, pr: { url: pr.url } }
						: { clipboard: false, ref: branch?.name ?? 'HEAD', repoPath: repo.path };
			} catch (ex) {
				Logger.error(ex, 'OpenAssociatedPullRequestOnRemoteCommand', 'No editor opened');
				return;
			}
		}

		await executeCommand<OpenPullRequestOnRemoteCommandArgs>(GlCommand.OpenPullRequestOnRemote, args);
	}
}
