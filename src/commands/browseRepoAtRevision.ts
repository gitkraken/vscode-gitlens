import type { TextEditor, Uri } from 'vscode';
import { Commands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { showGenericErrorMessage } from '../messages';
import { command, executeCoreCommand } from '../system/command';
import { Logger } from '../system/logger';
import { basename } from '../system/path';
import { openWorkspace } from '../system/utils';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri } from './base';

export interface BrowseRepoAtRevisionCommandArgs {
	uri?: Uri;

	before?: boolean;
	openInNewWindow?: boolean;
}

@command()
export class BrowseRepoAtRevisionCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			Commands.BrowseRepoAtRevision,
			Commands.BrowseRepoAtRevisionInNewWindow,
			Commands.BrowseRepoBeforeRevision,
			Commands.BrowseRepoBeforeRevisionInNewWindow,
		]);
	}

	protected override preExecute(context: CommandContext, args?: BrowseRepoAtRevisionCommandArgs) {
		switch (context.command) {
			case Commands.BrowseRepoAtRevisionInNewWindow:
				args = { ...args, before: false, openInNewWindow: true };
				break;
			case Commands.BrowseRepoBeforeRevision:
				args = { ...args, before: true, openInNewWindow: false };
				break;
			case Commands.BrowseRepoBeforeRevisionInNewWindow:
				args = { ...args, before: true, openInNewWindow: true };
				break;
		}

		return this.execute(context.editor!, context.uri, args);
	}

	async execute(editor: TextEditor, uri?: Uri, args?: BrowseRepoAtRevisionCommandArgs) {
		args = { ...args };

		try {
			if (args.uri == null) {
				uri = getCommandUri(uri, editor);
				if (uri == null) return;
			} else {
				uri = args.uri;
			}

			let gitUri = await GitUri.fromUri(uri);
			if (gitUri.sha == null) return;

			const sha = args?.before
				? await this.container.git.resolveReference(gitUri.repoPath!, `${gitUri.sha}^`)
				: gitUri.sha;
			uri = this.container.git.getRevisionUri(sha, gitUri.repoPath!, gitUri.repoPath!);
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
