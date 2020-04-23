'use strict';
import * as paths from 'path';
import { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { ActiveEditorCommand, command, Commands, executeCommand, getCommandUri } from './common';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { DiffWithCommandArgs } from './diffWith';
import { GitReference, GitRevision } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Messages } from '../messages';
import { ReferencePicker } from '../quickpicks';
import { Strings } from '../system';

export interface DiffWithRevisionFromCommandArgs {
	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithRevisionFromCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.DiffWithRevisionFrom);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithRevisionFromCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);
		if (!gitUri.repoPath) {
			Messages.showNoRepositoryWarningMessage('Unable to open file compare');

			return;
		}

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		const pick = await ReferencePicker.show(
			gitUri.repoPath,
			`Open Changes with Branch or Tag${Strings.pad(GlyphChars.Dot, 2, 2)}${gitUri.getFormattedPath()}`,
			'Choose a branch or tag to compare with',
			{
				allowEnteringRefs: true,
				// checkmarks: false,
			},
		);
		if (pick == null) return;

		const ref = pick.ref;
		if (ref == null) return;

		let renamedUri: Uri | undefined;
		let renamedTitle: string | undefined;

		// Check to see if this file has been renamed
		const files = await Container.git.getDiffStatus(gitUri.repoPath, 'HEAD', ref, { filters: ['R', 'C'] });
		if (files != null) {
			const fileName = Strings.normalizePath(paths.relative(gitUri.repoPath, gitUri.fsPath));
			const rename = files.find(s => s.fileName === fileName);
			if (rename?.originalFileName != null) {
				renamedUri = GitUri.resolveToUri(rename.originalFileName, gitUri.repoPath);
				renamedTitle = `${paths.basename(rename.originalFileName)} (${GitRevision.shorten(ref)})`;
			}
		}

		void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
			repoPath: gitUri.repoPath,
			lhs: {
				sha: GitReference.isBranch(pick) && pick.remote ? `remotes/${ref}` : ref,
				uri: renamedUri ?? gitUri,
				title: renamedTitle || `${paths.basename(gitUri.fsPath)} (${GitRevision.shorten(ref)})`,
			},
			rhs: {
				sha: '',
				uri: gitUri,
			},
			line: args.line,
			showOptions: args.showOptions,
		}));
	}
}
