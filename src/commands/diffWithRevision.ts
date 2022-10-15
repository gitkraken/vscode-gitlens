import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import * as nls from 'vscode-nls';
import { Commands, GlyphChars, quickPickTitleMaxChars } from '../constants';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { GitRevision } from '../git/models/reference';
import { Logger } from '../logger';
import { showGenericErrorMessage } from '../messages';
import { CommitPicker } from '../quickpicks/commitPicker';
import { CommandQuickPickItem } from '../quickpicks/items/common';
import { command, executeCommand } from '../system/command';
import { pad } from '../system/string';
import { ActiveEditorCommand, getCommandUri } from './base';
import type { DiffWithCommandArgs } from './diffWith';
import type { DiffWithRevisionFromCommandArgs } from './diffWithRevisionFrom';

const localize = nls.loadMessageBundle();

export interface DiffWithRevisionCommandArgs {
	line?: number;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithRevisionCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
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
			const log = this.container.git
				.getLogForFile(gitUri.repoPath, gitUri.fsPath)
				.then(
					log =>
						log ??
						(gitUri.sha
							? this.container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, { ref: gitUri.sha })
							: undefined),
				);

			const title = `${localize('openChangesWithRevision', 'Open Changes with Revision')}${pad(
				GlyphChars.Dot,
				2,
				2,
			)}`;
			const pick = await CommitPicker.show(
				log,
				`${title}${gitUri.getFormattedFileName({
					suffix: gitUri.sha ? `:${GitRevision.shorten(gitUri.sha)}` : undefined,
					truncateTo: quickPickTitleMaxChars - title.length,
				})}`,
				localize('chooseCommitToCompareWith', 'Choose a commit to compare with'),
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
						CommandQuickPickItem.fromCommand(
							localize('chooseBranchOrTag', 'Choose a branch or tag...'),
							Commands.DiffWithRevisionFrom,
						),
						CommandQuickPickItem.fromCommand<DiffWithRevisionFromCommandArgs>(
							localize('chooseStash', 'Choose a Stash...'),
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
			void showGenericErrorMessage(localize('unableToOpenCompare', 'Unable to open compare'));
		}
	}
}
