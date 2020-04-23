'use strict';
import { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { ActiveEditorCommand, command, Commands, getCommandUri } from './common';
import { FileAnnotationType } from '../configuration';
import { GlyphChars } from '../constants';
import { GitReference } from '../git/git';
import { GitUri } from '../git/gitUri';
import { GitActions } from './gitCommands';
import { ReferencePicker } from '../quickpicks';
import { Strings } from '../system';
import { Messages } from '../messages';

export interface OpenFileAtRevisionFromCommandArgs {
	reference?: GitReference;

	line?: number;
	showOptions?: TextDocumentShowOptions;
	annotationType?: FileAnnotationType;
}

@command()
export class OpenFileAtRevisionFromCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.OpenFileAtRevisionFrom);
	}

	async execute(editor: TextEditor | undefined, uri?: Uri, args?: OpenFileAtRevisionFromCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);
		if (!gitUri.repoPath) {
			Messages.showNoRepositoryWarningMessage('Unable to open file revision');
			return;
		}

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		if (args.reference == null) {
			const pick = await ReferencePicker.show(
				gitUri.repoPath,
				`Open File at Revision${Strings.pad(GlyphChars.Dot, 2, 2)}${gitUri.getFormattedPath()}`,
				'Choose a branch or tag to open the file revision from',
				{
					allowEnteringRefs: true,
					keys: ['right', 'alt+right', 'ctrl+right'],
					onDidPressKey: async (key, quickpick) => {
						const [item] = quickpick.activeItems;
						if (item != null) {
							void (await GitActions.Commit.openFileAtRevision(
								GitUri.toRevisionUri(item.ref, gitUri.fsPath, gitUri.repoPath!),
								{
									annotationType: args!.annotationType,
									line: args!.line,
									preserveFocus: true,
									preview: false,
								},
							));
						}
					},
				},
			);
			if (pick == null) return;

			args.reference = pick;
		}

		void (await GitActions.Commit.openFileAtRevision(
			GitUri.toRevisionUri(args.reference.ref, gitUri.fsPath, gitUri.repoPath),
			{
				annotationType: args.annotationType,
				line: args.line,
				...args.showOptions,
			},
		));
	}
}
