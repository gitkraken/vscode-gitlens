'use strict';
import { commands, TextEditor, Uri } from 'vscode';
import { BuiltInCommands } from '../constants';
import { Container } from '../container';
import { toGitLensFSUri } from '../git/fsProvider';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { basename } from '../system/path';
import {
	ActiveEditorCommand,
	command,
	CommandContext,
	Commands,
	getCommandUri,
	openWorkspace,
	OpenWorkspaceLocation,
} from './common';

export interface BrowseRepoAtRevisionCommandArgs {
	uri?: Uri;

	before?: boolean;
	openInNewWindow?: boolean;
}

@command()
export class BrowseRepoAtRevisionCommand extends ActiveEditorCommand {
	constructor() {
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
				? await Container.instance.git.resolveReference(gitUri.repoPath!, `${gitUri.sha}^`)
				: gitUri.sha;
			uri = toGitLensFSUri(sha, gitUri.repoPath!);
			gitUri = GitUri.fromRevisionUri(uri);

			openWorkspace(uri, {
				location: args.openInNewWindow ? OpenWorkspaceLocation.NewWindow : OpenWorkspaceLocation.AddToWorkspace,
				name: `${basename(gitUri.repoPath!)} @ ${gitUri.shortSha}`,
			});

			if (!args.openInNewWindow) {
				void commands.executeCommand(BuiltInCommands.FocusFilesExplorer);
			}
		} catch (ex) {
			Logger.error(ex, 'BrowseRepoAtRevisionCommand');
			void Messages.showGenericErrorMessage('Unable to open the repository at the specified revision');
		}
	}
}
