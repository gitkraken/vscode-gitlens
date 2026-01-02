import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { GlyphChars, quickPickTitleMaxChars } from '../constants.js';
import type { Container } from '../container.js';
import type { DiffRange } from '../git/gitProvider.js';
import { GitUri } from '../git/gitUri.js';
import { shortenRevision } from '../git/utils/revision.utils.js';
import { showGenericErrorMessage } from '../messages.js';
import { showCommitPicker } from '../quickpicks/commitPicker.js';
import { CommandQuickPickItem } from '../quickpicks/items/common.js';
import type { DirectiveQuickPickItem } from '../quickpicks/items/directive.js';
import { createDirectiveQuickPickItem, Directive } from '../quickpicks/items/directive.js';
import { command, executeCommand } from '../system/-webview/command.js';
import { splitPath } from '../system/-webview/path.js';
import { selectionToDiffRange } from '../system/-webview/vscode/editors.js';
import { Logger } from '../system/logger.js';
import { pad } from '../system/string.js';
import { ActiveEditorCommand } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';
import type { DiffWithCommandArgs } from './diffWith.js';
import type { DiffWithRevisionFromCommandArgs } from './diffWithRevisionFrom.js';

export interface DiffWithRevisionCommandArgs {
	range?: DiffRange;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithRevisionCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.diffWithRevision');
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithRevisionCommandArgs): Promise<any> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		args = { ...args };
		args.range ??= selectionToDiffRange(editor?.selection);

		try {
			const svc = this.container.git.getRepositoryService(gitUri.repoPath!);
			const log = svc.commits
				.getLogForPath(gitUri.fsPath, undefined, { isFolder: false })
				.then(
					log =>
						log ??
						(gitUri.sha
							? svc.commits.getLogForPath(gitUri.fsPath, gitUri.sha, { isFolder: false })
							: undefined),
				);

			const title = `Open Changes with Revision${pad(GlyphChars.Dot, 2, 2)}`;
			const titleWithContext = `${title}${gitUri.getFormattedFileName({
				suffix: gitUri.sha ? `:${shortenRevision(gitUri.sha)}` : undefined,
				truncateTo: quickPickTitleMaxChars - title.length,
			})}`;
			const pick = await showCommitPicker(log, titleWithContext, 'Choose a commit to compare with', {
				empty: !gitUri.sha
					? {
							getState: async () => {
								const items: (CommandQuickPickItem | DirectiveQuickPickItem)[] = [];

								const status = await svc.status.getStatus();
								if (status != null) {
									for (const f of status.files) {
										if (f.workingTreeStatus === '?' || f.workingTreeStatus === '!') {
											continue;
										}

										const [label, description] = splitPath(f.path, undefined, true);

										items.push(
											new CommandQuickPickItem<[Uri]>(
												{
													label: label,
													description: description,
												},
												undefined,
												'gitlens.diffWithRevision',
												[svc.getAbsoluteUri(f.path, gitUri.repoPath)],
											),
										);
									}
								}

								let newPlaceholder;
								let newTitle;

								if (items.length) {
									newPlaceholder = `${gitUri.getFormattedFileName()} is likely untracked, choose a different file?`;
									newTitle = `${titleWithContext} (Untracked?)`;
								} else {
									newPlaceholder = 'No commits found';
								}

								items.push(
									createDirectiveQuickPickItem(Directive.Cancel, undefined, {
										label: items.length ? 'Cancel' : 'OK',
									}),
								);

								return {
									items: items,
									placeholder: newPlaceholder,
									title: newTitle,
								};
							},
						}
					: undefined,
				picked: gitUri.sha,
				keyboard: {
					keys: ['right', 'alt+right', 'ctrl+right'],
					onDidPressKey: async (_key, item) => {
						await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
							repoPath: gitUri.repoPath,
							lhs: { sha: item.item.ref, uri: gitUri },
							rhs: { sha: '', uri: gitUri },
							range: args.range,
							showOptions: args.showOptions,
						});
					},
				},
				showOtherReferences: [
					CommandQuickPickItem.fromCommand<[Uri]>(
						'Choose a Branch or Tag...',
						'gitlens.diffWithRevisionFrom',
						[uri],
					),
					CommandQuickPickItem.fromCommand<[Uri, DiffWithRevisionFromCommandArgs]>(
						'Choose a Stash...',
						'gitlens.diffWithRevisionFrom',
						[uri, { stash: true }],
					),
				],
			});
			if (pick == null) return;

			void (await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
				repoPath: gitUri.repoPath,
				lhs: { sha: pick.ref, uri: gitUri },
				rhs: { sha: '', uri: gitUri },
				range: args.range,
				showOptions: args.showOptions,
			}));
		} catch (ex) {
			Logger.error(ex, 'DiffWithRevisionCommand');
			void showGenericErrorMessage('Unable to open compare');
		}
	}
}
