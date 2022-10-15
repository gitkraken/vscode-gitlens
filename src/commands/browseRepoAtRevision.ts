import type { TextEditor, Uri } from 'vscode';
import * as nls from 'vscode-nls';
import { Commands, CoreCommands } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { showGenericErrorMessage } from '../messages';
import { command, executeCoreCommand } from '../system/command';
import { basename } from '../system/path';
import { openWorkspace, OpenWorkspaceLocation } from '../system/utils';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri } from './base';

const localize = nls.loadMessageBundle();

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
				location: args.openInNewWindow ? OpenWorkspaceLocation.NewWindow : OpenWorkspaceLocation.AddToWorkspace,
				name: `${basename(gitUri.repoPath!)} @ ${gitUri.shortSha}`,
			});

			if (!args.openInNewWindow) {
				void executeCoreCommand(CoreCommands.FocusFilesExplorer);
			}
		} catch (ex) {
			Logger.error(ex, 'BrowseRepoAtRevisionCommand');
			void showGenericErrorMessage(
				localize('unableToOpenRepositoryAtRevision', 'Unable to open the repository at the specified revision'),
			);
		}
	}
}
