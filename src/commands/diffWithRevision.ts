'use strict';
import { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { GlyphChars, quickPickTitleMaxChars } from '../constants';
import { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { GitRevision } from '../git/models';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { CommandQuickPickItem, CommitPicker } from '../quickpicks';
import { Strings } from '../system';
import { ActiveEditorCommand, command, Commands, executeCommand, getCommandUri } from './common';
import { DiffWithCommandArgs } from './diffWith';
import { DiffWithRevisionFromCommandArgs } from './diffWithRevisionFrom';

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
			const log = Container.instance.git
				.getLogForFile(gitUri.repoPath, gitUri.fsPath)
				.then(
					log =>
						log ??
						(gitUri.sha
							? Container.instance.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, { ref: gitUri.sha })
							: undefined),
				);

			const title = `Open Changes with Revision${Strings.pad(GlyphChars.Dot, 2, 2)}`;
			const pick = await CommitPicker.show(
				log,
				`${title}${gitUri.getFormattedFileName({
					suffix: gitUri.sha ? `:${GitRevision.shorten(gitUri.sha)}` : undefined,
					truncateTo: quickPickTitleMaxChars - title.length,
				})}`,
				'Choose a commit to compare with',
				{
					picked: gitUri.sha,
					keys: ['right', 'alt+right', 'ctrl+right'],
					onDidPressKey: async (key, item) => {
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
					},
					showOtherReferences: [
						CommandQuickPickItem.fromCommand('Choose a Branch or Tag...', Commands.DiffWithRevisionFrom),
						CommandQuickPickItem.fromCommand<DiffWithRevisionFromCommandArgs>(
							'Choose a Stash...',
							Commands.DiffWithRevisionFrom,
							{ stash: true },
						),
					],
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
			void Messages.showGenericErrorMessage('Unable to open compare');
		}
	}
}
