'use strict';
import * as paths from 'path';
import { commands, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitService, GitUri } from '../git/gitService';
import { Messages } from '../messages';
import { CommandQuickPickItem, ReferencesQuickPick } from '../quickpicks';
import { Strings } from '../system';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';

export interface DiffWithRefCommandArgs {
	line?: number;
	showOptions?: TextDocumentShowOptions;

	goBackCommand?: CommandQuickPickItem;
}

@command()
export class DiffWithRefCommand extends ActiveEditorCommand {
	constructor() {
		super([Commands.DiffWithRef, Commands.DiffWithBranch]);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithRefCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return undefined;

		args = { ...args };
		if (args.line === undefined) {
			args.line = editor == null ? 0 : editor.selection.active.line;
		}

		const gitUri = await GitUri.fromUri(uri);
		if (!gitUri.repoPath) return Messages.showNoRepositoryWarningMessage('Unable to open file compare');

		const pick = await new ReferencesQuickPick(gitUri.repoPath).show(
			`Compare ${gitUri.getFormattedPath()} with${GlyphChars.Ellipsis}`,
			{
				allowEnteringRefs: true,
				checkmarks: false,
				goBack: args.goBackCommand,
			},
		);
		if (pick === undefined) return undefined;

		if (pick instanceof CommandQuickPickItem) return pick.execute();

		const ref = pick.ref;
		if (ref === undefined) return undefined;

		let renamedUri: Uri | undefined;
		let renamedTitle: string | undefined;

		// Check to see if this file has been renamed
		const files = await Container.git.getDiffStatus(gitUri.repoPath, 'HEAD', ref, { filters: ['R', 'C'] });
		if (files !== undefined) {
			const fileName = Strings.normalizePath(paths.relative(gitUri.repoPath, gitUri.fsPath));
			const rename = files.find(s => s.fileName === fileName);
			if (rename !== undefined && rename.originalFileName !== undefined) {
				renamedUri = GitUri.resolveToUri(rename.originalFileName, gitUri.repoPath);
				renamedTitle = `${paths.basename(rename.originalFileName)} (${GitService.shortenSha(ref)})`;
			}
		}

		const diffArgs: DiffWithCommandArgs = {
			repoPath: gitUri.repoPath,
			lhs: {
				sha: pick.remote ? `remotes/${ref}` : ref,
				uri: renamedUri || (gitUri as Uri),
				title: renamedTitle || `${paths.basename(gitUri.fsPath)} (${GitService.shortenSha(ref)})`,
			},
			rhs: {
				sha: '',
				uri: gitUri as Uri,
			},
			line: args.line,
			showOptions: args.showOptions,
		};
		return commands.executeCommand(Commands.DiffWith, diffArgs);
	}
}
