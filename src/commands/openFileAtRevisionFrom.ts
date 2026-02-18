import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import type { FileAnnotationType } from '../config.js';
import { GlyphChars, quickPickTitleMaxChars } from '../constants.js';
import type { Container } from '../container.js';
import { openFileAtRevision } from '../git/actions/commit.js';
import { GitUri } from '../git/gitUri.js';
import type { GitReference } from '../git/models/reference.js';
import { showNoRepositoryWarningMessage } from '../messages.js';
import { showReferencePicker } from '../quickpicks/referencePicker.js';
import { showStashPicker } from '../quickpicks/stashPicker.js';
import { command } from '../system/-webview/command.js';
import { pad } from '../system/string.js';
import { ActiveEditorCommand } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';

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
		args.line ??= editor?.selection.active.line ?? 0;

		const svc = this.container.git.getRepositoryService(gitUri.repoPath);

		if (args.reference == null) {
			if (args?.stash) {
				const path = svc.getRelativePath(gitUri, gitUri.repoPath);

				const title = `Open Changes with Stash${pad(GlyphChars.Dot, 2, 2)}`;
				const pick = await showStashPicker(
					svc.stash?.getStash(),
					`${title}${gitUri.getFormattedFileName({ truncateTo: quickPickTitleMaxChars - title.length })}`,
					'Choose a stash to compare with',
					// Stashes should always come with files, so this should be fine (but protect it just in case)
					{
						filter: c => c.anyFiles?.some(f => f.path === path || f.originalPath === path) ?? true,
					},
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
						allowedAdditionalInput: { rev: true },
						keyboard: {
							keys: ['right', 'alt+right', 'ctrl+right'],
							onDidPressKey: async (_key, item) => {
								await openFileAtRevision(svc.getRevisionUri(item.ref, gitUri.fsPath), {
									annotationType: args.annotationType,
									line: args.line,
									preserveFocus: true,
									preview: true,
								});
							},
						},
					},
				);
				if (pick == null) return;

				args.reference = pick;
			}
		}

		await openFileAtRevision(svc.getRevisionUri(args.reference.ref, gitUri.fsPath), {
			annotationType: args.annotationType,
			line: args.line,
			...args.showOptions,
		});
	}
}
