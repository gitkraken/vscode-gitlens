'use strict';
import { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { ActiveEditorCommand, command, Commands, executeCommand, getCommandUri } from './common';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { DiffWithCommandArgs } from './diffWith';
import { GitRevision } from '../git/git';
import { GitUri } from '../git/gitUri';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommitPicker, DirectiveQuickPickItem } from '../quickpicks';
import { Strings } from '../system';

export interface DiffWithRevisionCommandArgs {
	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithRevisionCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.DiffWithRevision);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithRevisionCommandArgs): Promise<any> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		try {
			const log = Container.git
				.getLogForFile(gitUri.repoPath, gitUri.fsPath)
				.then(
					log =>
						log ??
						(gitUri.sha
							? Container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, { ref: gitUri.sha })
							: undefined),
				);

			const pick = await CommitPicker.show(
				log,
				`Open Changes with Revision${Strings.pad(GlyphChars.Dot, 2, 2)}${gitUri.getFormattedPath({
					suffix: gitUri.sha ? `:${GitRevision.shorten(gitUri.sha)}` : undefined,
				})}`,
				'Choose a commit to compare with',
				{
					picked: gitUri.sha,
					keys: ['right', 'alt+right', 'ctrl+right'],
					onDidPressKey: async (key, quickpick) => {
						const [item] = quickpick.activeItems;
						if (item != null && !DirectiveQuickPickItem.is(item)) {
							void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
								repoPath: gitUri.repoPath,
								lhs: {
									sha: item.item.ref,
									uri: gitUri,
								},
								rhs: {
									sha: '',
									uri: gitUri,
								},
								line: args!.line,
								showOptions: args!.showOptions,
							}));
						}
					},
				},
			);
			if (pick == null) return;

			void (await executeCommand<DiffWithCommandArgs>(Commands.DiffWith, {
				repoPath: gitUri.repoPath,
				lhs: {
					sha: pick.ref,
					uri: gitUri,
				},
				rhs: {
					sha: '',
					uri: gitUri,
				},
				line: args.line,
				showOptions: args.showOptions,
			}));
		} catch (ex) {
			Logger.error(ex, 'DiffWithRevisionCommand');
			Messages.showGenericErrorMessage('Unable to open compare');
		}
	}
}
