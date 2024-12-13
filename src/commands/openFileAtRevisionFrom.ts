import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import type { FileAnnotationType } from '../config';
import { GlyphChars, quickPickTitleMaxChars } from '../constants';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { openFileAtRevision } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import type { GitReference } from '../git/models/reference';
import { showNoRepositoryWarningMessage } from '../messages';
import { showStashPicker } from '../quickpicks/commitPicker';
import { showReferencePicker } from '../quickpicks/referencePicker';
import { pad } from '../system/string';
import { command } from '../system/vscode/command';
import { ActiveEditorCommand, getCommandUri } from './base';

export interface OpenFileAtRevisionFromCommandArgs {
	reference?: GitReference;

	line?: number;
	showOptions?: TextDocumentShowOptions;
	annotationType?: FileAnnotationType;
	stash?: boolean;
}

@command()
export class OpenFileAtRevisionFromCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(GlCommand.OpenFileAtRevisionFrom);
	}

	async execute(editor: TextEditor | undefined, uri?: Uri, args?: OpenFileAtRevisionFromCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);
		if (!gitUri.repoPath) {
			void showNoRepositoryWarningMessage('Unable to open file revision');
			return;
		}

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		if (args.reference == null) {
			if (args?.stash) {
				const path = this.container.git.getRelativePath(gitUri, gitUri.repoPath);

				const title = `Open Changes with Stash${pad(GlyphChars.Dot, 2, 2)}`;
				const pick = await showStashPicker(
					this.container.git.getStash(gitUri.repoPath),
					`${title}${gitUri.getFormattedFileName({ truncateTo: quickPickTitleMaxChars - title.length })}`,
					'Choose a stash to compare with',
					// Stashes should always come with files, so this should be fine (but protect it just in case)
					{ filter: c => c.files?.some(f => f.path === path || f.originalPath === path) ?? true },
				);
				if (pick == null) return;

				args.reference = pick;
			} else {
				const title = `Open File at Branch or Tag${pad(GlyphChars.Dot, 2, 2)}`;
				const pick = await showReferencePicker(
					gitUri.repoPath,
					`${title}${gitUri.getFormattedFileName({ truncateTo: quickPickTitleMaxChars - title.length })}`,
					'Choose a branch or tag to open the file revision from',
					{
						allowRevisions: true,
						keyboard: {
							keys: ['right', 'alt+right', 'ctrl+right'],
							onDidPressKey: async (_key, item) => {
								await openFileAtRevision(
									this.container.git.getRevisionUri(item.ref, gitUri.fsPath, gitUri.repoPath!),
									{
										annotationType: args.annotationType,
										line: args.line,
										preserveFocus: true,
										preview: true,
									},
								);
							},
						},
					},
				);
				if (pick == null) return;

				args.reference = pick;
			}
		}

		await openFileAtRevision(
			this.container.git.getRevisionUri(args.reference.ref, gitUri.fsPath, gitUri.repoPath),
			{
				annotationType: args.annotationType,
				line: args.line,
				...args.showOptions,
			},
		);
	}
}
