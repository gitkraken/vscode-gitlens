import type { TextDocumentShowOptions, TextEditor } from 'vscode';
import { Uri } from 'vscode';
import type { FileAnnotationType } from '../config';
import { Commands, GlyphChars, quickPickTitleMaxChars } from '../constants';
import type { Container } from '../container';
import { openFileAtRevision } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import { shortenRevision } from '../git/models/reference';
import { showCommitHasNoPreviousCommitWarningMessage, showGenericErrorMessage } from '../messages';
import { showCommitPicker } from '../quickpicks/commitPicker';
import { CommandQuickPickItem } from '../quickpicks/items/common';
import type { DirectiveQuickPickItem } from '../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive } from '../quickpicks/items/directive';
import { command } from '../system/command';
import { Logger } from '../system/logger';
import { splitPath } from '../system/path';
import { pad } from '../system/string';
import type { CommandContext } from './base';
import { ActiveEditorCommand, getCommandUri } from './base';
import type { OpenFileAtRevisionFromCommandArgs } from './openFileAtRevisionFrom';

export interface OpenFileAtRevisionCommandArgs {
	revisionUri?: Uri;

	line?: number;
	showOptions?: TextDocumentShowOptions;
	annotationType?: FileAnnotationType;
}

@command()
export class OpenFileAtRevisionCommand extends ActiveEditorCommand {
	static getMarkdownCommandArgs(args: OpenFileAtRevisionCommandArgs): string;
	static getMarkdownCommandArgs(revisionUri: Uri, annotationType?: FileAnnotationType, line?: number): string;
	static getMarkdownCommandArgs(
		argsOrUri: OpenFileAtRevisionCommandArgs | Uri,
		annotationType?: FileAnnotationType,
		line?: number,
	): string {
		let args: OpenFileAtRevisionCommandArgs | Uri;
		if (argsOrUri instanceof Uri) {
			const revisionUri = argsOrUri;

			args = {
				revisionUri: revisionUri,
				line: line,
				annotationType: annotationType,
			};
		} else {
			args = argsOrUri;
		}

		return super.getMarkdownCommandArgsCore<OpenFileAtRevisionCommandArgs>(Commands.OpenFileAtRevision, args);
	}

	constructor(private readonly container: Container) {
		super([Commands.OpenFileAtRevision, Commands.OpenBlamePriorToChange]);
	}

	protected override async preExecute(context: CommandContext, args?: OpenFileAtRevisionCommandArgs) {
		if (context.command === Commands.OpenBlamePriorToChange) {
			args = { ...args, annotationType: 'blame' };
			if (args.revisionUri == null && context.editor != null) {
				const editorLine = context.editor.selection.active.line;
				if (editorLine >= 0) {
					try {
						const gitUri = await GitUri.fromUri(context.editor.document.uri);
						const blame = await this.container.git.getBlameForLine(gitUri, editorLine);
						if (blame != null) {
							if (blame.commit.isUncommitted) {
								const comparisonUris = await blame.commit.getPreviousComparisonUrisForLine(editorLine);
								if (comparisonUris?.previous != null) {
									args.revisionUri = this.container.git.getRevisionUri(comparisonUris.previous);
								} else {
									void showCommitHasNoPreviousCommitWarningMessage(blame.commit);
									return undefined;
								}
							} else {
								const previousSha = blame != null ? await blame?.commit.getPreviousSha() : undefined;
								if (previousSha != null) {
									args.revisionUri = this.container.git.getRevisionUri(blame.commit.getGitUri(true));
								} else {
									void showCommitHasNoPreviousCommitWarningMessage(blame.commit);
									return undefined;
								}
							}
						}
					} catch (ex) {
						Logger.error(ex, 'OpenBlamePriorToChangeCommand');
					}
				}
			}

			if (args.revisionUri == null) {
				void showGenericErrorMessage('Unable to open blame');
				return undefined;
			}
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor: TextEditor | undefined, uri?: Uri, args?: OpenFileAtRevisionCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		args = { ...args };
		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		try {
			if (args.revisionUri == null) {
				const log = this.container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath).then(
					log =>
						log ??
						(gitUri.sha
							? this.container.git.getLogForFile(gitUri.repoPath, gitUri.fsPath, {
									ref: gitUri.sha,
							  })
							: undefined),
				);

				const title = `Open ${args.annotationType === 'blame' ? 'Blame' : 'File'} at Revision${pad(
					GlyphChars.Dot,
					2,
					2,
				)}`;
				const titleWithContext = `${title}${gitUri.getFormattedFileName({
					suffix: gitUri.sha ? `:${shortenRevision(gitUri.sha)}` : undefined,
					truncateTo: quickPickTitleMaxChars - title.length,
				})}`;
				const pick = await showCommitPicker(
					log,
					titleWithContext,
					`Choose a commit to ${args.annotationType === 'blame' ? 'blame' : 'open'} the file revision from`,
					{
						empty: !gitUri.sha
							? {
									getState: async () => {
										const items: (CommandQuickPickItem | DirectiveQuickPickItem)[] = [];

										const status = await this.container.git.getStatusForRepo(gitUri.repoPath);
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
														Commands.OpenFileAtRevision,
														[this.container.git.getAbsoluteUri(f.path, gitUri.repoPath)],
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
							onDidPressKey: async (key, item) => {
								await openFileAtRevision(item.item.file!, item.item, {
									annotationType: args!.annotationType,
									line: args!.line,
									preserveFocus: true,
									preview: true,
								});
							},
						},
						showOtherReferences: [
							CommandQuickPickItem.fromCommand(
								'Choose a Branch or Tag...',
								Commands.OpenFileAtRevisionFrom,
							),
							CommandQuickPickItem.fromCommand<OpenFileAtRevisionFromCommandArgs>(
								'Choose a Stash...',
								Commands.OpenFileAtRevisionFrom,
								{ stash: true },
							),
						],
					},
				);
				if (pick?.file == null) return;

				await openFileAtRevision(pick.file, pick, {
					annotationType: args.annotationType,
					line: args.line,
					...args.showOptions,
				});

				return;
			}

			await openFileAtRevision(args.revisionUri, {
				annotationType: args.annotationType,
				line: args.line,
				...args.showOptions,
			});
		} catch (ex) {
			Logger.error(ex, 'OpenFileAtRevisionCommand');
			void showGenericErrorMessage('Unable to open file at revision');
		}
	}
}
