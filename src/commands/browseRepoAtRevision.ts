import type { TextEditor, Uri } from 'vscode';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { showGenericErrorMessage } from '../messages';
import { command, executeCoreCommand } from '../system/-webview/command';
import { openWorkspace } from '../system/-webview/vscode/workspaces';
import { Logger } from '../system/logger';
import { basename } from '../system/path';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';

export interface BrowseRepoAtRevisionCommandArgs {
	uri?: Uri;

	before?: boolean;
	openInNewWindow?: boolean;
}

@command()
export class BrowseRepoAtRevisionCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			'gitlens.browseRepoAtRevision',
			'gitlens.browseRepoAtRevisionInNewWindow',
			'gitlens.browseRepoBeforeRevision',
			'gitlens.browseRepoBeforeRevisionInNewWindow',
		]);
	}

	protected override preExecute(context: CommandContext, args?: BrowseRepoAtRevisionCommandArgs): Promise<void> {
		switch (context.command) {
			case 'gitlens.browseRepoAtRevisionInNewWindow':
				args = { ...args, before: false, openInNewWindow: true };
				break;
			case 'gitlens.browseRepoBeforeRevision':
				args = { ...args, before: true, openInNewWindow: false };
				break;
			case 'gitlens.browseRepoBeforeRevisionInNewWindow':
				args = { ...args, before: true, openInNewWindow: true };
				break;
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor: TextEditor | undefined, uri?: Uri, args?: BrowseRepoAtRevisionCommandArgs): Promise<void> {
		args = { ...args };

		try {
			if (args.uri == null) {
				uri = getCommandUri(uri, editor);
				if (uri == null) return;
			} else {
				uri = args.uri;
			}

			let gitUri = await GitUri.fromUri(uri);
			if (gitUri.repoPath == null || gitUri.sha == null) throw new Error('No repo or SHA for Uri');

			const svc = this.container.git.getRepositoryService(gitUri.repoPath);

			const sha = args?.before ? (await svc.revision.resolveRevision(`${gitUri.sha}^`)).sha : gitUri.sha;
			uri = svc.getRevisionUri(sha, gitUri.repoPath);
			gitUri = GitUri.fromRevisionUri(uri);

			openWorkspace(uri, {
				location: args.openInNewWindow ? 'newWindow' : 'addToWorkspace',
				name: `${basename(gitUri.repoPath!)} @ ${gitUri.shortSha}`,
			});

			if (!args.openInNewWindow) {
				void executeCoreCommand('workbench.files.action.focusFilesExplorer');
			}
		} catch (ex) {
			Logger.error(ex, 'BrowseRepoAtRevisionCommand');
			void showGenericErrorMessage('Unable to open the repository at the specified revision');
		}
	}
}
