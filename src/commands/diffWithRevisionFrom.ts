'use strict';
import { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { GlyphChars, quickPickTitleMaxChars } from '../constants';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { GitReference, GitRevision } from '../git/models';
import { Messages } from '../messages';
import { ReferencePicker, StashPicker } from '../quickpicks';
import { Strings } from '../system';
import { basename, normalizePath, relative } from '../system/path';
import { ActiveEditorCommand, command, Commands, executeCommand, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';

export interface DiffWithRevisionFromCommandArgs {
	line?: number;
	showOptions?: TextDocumentShowOptions;
	stash?: boolean;
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
			void Messages.showNoRepositoryWarningMessage('Unable to open file compare');

			return;
		}

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		let ref;
		let sha;
		if (args?.stash) {
			const fileName = normalizePath(relative(gitUri.repoPath, gitUri.fsPath));

			const title = `Open Changes with Stash${Strings.pad(GlyphChars.Dot, 2, 2)}`;
			const pick = await StashPicker.show(
				Container.instance.git.getStash(gitUri.repoPath),
				`${title}${gitUri.getFormattedFileName({ truncateTo: quickPickTitleMaxChars - title.length })}`,
				'Choose a stash to compare with',
				{
					empty: `No stashes with '${gitUri.getFormattedFileName()}' found`,
					filter: c => c.files.some(f => f.fileName === fileName || f.originalFileName === fileName),
				},
			);
			if (pick == null) return;

			ref = pick.ref;
			sha = ref;
		} else {
			const title = `Open Changes with Branch or Tag${Strings.pad(GlyphChars.Dot, 2, 2)}`;
			const pick = await ReferencePicker.show(
				gitUri.repoPath,
				`${title}${gitUri.getFormattedFileName({ truncateTo: quickPickTitleMaxChars - title.length })}`,
				'Choose a branch or tag to compare with',
				{
					allowEnteringRefs: true,
					// checkmarks: false,
				},
			);
			if (pick == null) return;

			ref = pick.ref;
			sha = GitReference.isBranch(pick) && pick.remote ? `remotes/${ref}` : ref;
		}

		if (ref == null) return;

		let renamedUri: Uri | undefined;
		let renamedTitle: string | undefined;

		// Check to see if this file has been renamed
		const files = await Container.instance.git.getDiffStatus(gitUri.repoPath, 'HEAD', ref, { filters: ['R', 'C'] });
		if (files != null) {
			const fileName = normalizePath(relative(gitUri.repoPath, gitUri.fsPath));
			const rename = files.find(s => s.fileName === fileName);
			if (rename?.originalFileName != null) {
				renamedUri = GitUri.resolve(rename.originalFileName, gitUri.repoPath);
				renamedTitle = `${basename(rename.originalFileName)} (${GitRevision.shorten(ref)})`;
			}
		}

		void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
			repoPath: gitUri.repoPath,
			lhs: {
				sha: sha,
				uri: renamedUri ?? gitUri,
				title: renamedTitle ?? `${basename(gitUri.fsPath)} (${GitRevision.shorten(ref)})`,
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
