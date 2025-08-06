import type { TextEditor, Uri } from 'vscode';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { getRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { command, executeCommand } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { OpenPullRequestOnRemoteCommandArgs } from './openPullRequestOnRemote';

@command()
export class OpenAssociatedPullRequestOnRemoteCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.openAssociatedPullRequestOnRemote');
	}

	async execute(editor?: TextEditor, uri?: Uri): Promise<void> {
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
				const repo = await getRepositoryOrShowPicker(
					this.container,
					'Open Associated Pull Request',
					undefined,
					undefined,
					{
						filter: async r => (await r.git.remotes.getBestRemoteWithIntegration()) != null,
					},
				);
				if (repo == null) return;

				const branch = await repo?.git.branches.getBranch();
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

		await executeCommand<OpenPullRequestOnRemoteCommandArgs>('gitlens.openPullRequestOnRemote', args);
	}
}
