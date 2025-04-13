import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import type { FileAnnotationType } from '../config';
import { GlyphChars, quickPickTitleMaxChars } from '../constants';
import type { Container } from '../container';
import { openFileAtRevision } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import type { GitReference } from '../git/models/reference';
import { showNoRepositoryWarningMessage } from '../messages';
import { showStashPicker } from '../quickpicks/commitPicker';
import { showReferencePicker } from '../quickpicks/referencePicker';
import { command } from '../system/-webview/command';
import { pad } from '../system/string';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';

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
		super('gitlens.openFileRevisionFrom');
	}

	async execute(editor: TextEditor | undefined, uri?: Uri, args?: OpenFileAtRevisionFromCommandArgs): Promise<void> {
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
					this.container.git.stash(gitUri.repoPath)?.getStash(),
					`${title}${gitUri.getFormattedFileName({ truncateTo: quickPickTitleMaxChars - title.length })}`,
					'Choose a stash to compare with',
					// Stashes should always come with files, so this should be fine (but protect it just in case)
					{ filter: c => c.fileset?.files.some(f => f.path === path || f.originalPath === path) ?? true },
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
									this.container.git.getRevisionUri(gitUri.repoPath!, item.ref, gitUri.fsPath),
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
			this.container.git.getRevisionUri(gitUri.repoPath, args.reference.ref, gitUri.fsPath),
			{
				annotationType: args.annotationType,
				line: args.line,
				...args.showOptions,
			},
		);
	}
}
