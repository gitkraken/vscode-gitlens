import type { TextDocumentShowOptions, TextEditor } from 'vscode';
import { Uri } from 'vscode';
import type { FileAnnotationType } from '../config';
import { GlyphChars, quickPickTitleMaxChars } from '../constants';
import type { Source } from '../constants.telemetry';
import type { Container } from '../container';
import { openFileAtRevision } from '../git/actions/commit';
import type { DiffRange } from '../git/gitProvider';
import { GitUri } from '../git/gitUri';
import { shortenRevision } from '../git/utils/revision.utils';
import { showCommitHasNoPreviousCommitWarningMessage, showGenericErrorMessage } from '../messages';
import { showCommitPicker } from '../quickpicks/commitPicker';
import { CommandQuickPickItem } from '../quickpicks/items/common';
import type { DirectiveQuickPickItem } from '../quickpicks/items/directive';
import { createDirectiveQuickPickItem, Directive } from '../quickpicks/items/directive';
import { command } from '../system/-webview/command';
import { splitPath } from '../system/-webview/path';
import { diffRangeToEditorLine, selectionToDiffRange } from '../system/-webview/vscode/editors';
import { createMarkdownCommandLink } from '../system/commands';
import { Logger } from '../system/logger';
import { pad } from '../system/string';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';
import type { OpenFileAtRevisionFromCommandArgs } from './openFileAtRevisionFrom';

export interface OpenFileAtRevisionCommandArgs {
	revisionUri?: Uri;

	range?: DiffRange;
	showOptions?: TextDocumentShowOptions;
	annotationType?: FileAnnotationType;
	source?: Source;
}

@command()
export class OpenFileAtRevisionCommand extends ActiveEditorCommand {
	static createMarkdownCommandLink(args: OpenFileAtRevisionCommandArgs): string;
	static createMarkdownCommandLink(
		revisionUri: Uri,
		annotationType?: FileAnnotationType,
		range?: DiffRange,
		source?: Source,
	): string;
	static createMarkdownCommandLink(
		argsOrUri: OpenFileAtRevisionCommandArgs | Uri,
		annotationType?: FileAnnotationType,
		range?: DiffRange,
		source?: Source,
	): string {
		let args: OpenFileAtRevisionCommandArgs | Uri;
		if (argsOrUri instanceof Uri) {
			const revisionUri = argsOrUri;

			args = { revisionUri: revisionUri, range: range, annotationType: annotationType, source: source };
		} else {
			args = argsOrUri;
		}

		return createMarkdownCommandLink<OpenFileAtRevisionCommandArgs>('gitlens.openFileRevision', args);
	}

	constructor(private readonly container: Container) {
		super(['gitlens.openFileRevision', 'gitlens.openBlamePriorToChange']);
	}

	protected override async preExecute(context: CommandContext, args?: OpenFileAtRevisionCommandArgs): Promise<void> {
		if (context.command === 'gitlens.openBlamePriorToChange') {
			args = { ...args, annotationType: 'blame' };
			if (args.revisionUri == null && context.editor != null) {
				const range = selectionToDiffRange(context.editor.selection);
				if (range != null) {
					const editorLine = diffRangeToEditorLine(range);
					try {
						const gitUri = await GitUri.fromUri(context.editor.document.uri);
						const blame = await this.container.git.getBlameForLine(gitUri, editorLine);
						if (blame != null) {
							if (blame.commit.isUncommitted) {
								const comparisonUris = await blame.commit.getPreviousComparisonUrisForRange(range);
								if (comparisonUris?.previous != null) {
									args.revisionUri = this.container.git.getRevisionUriFromGitUri(
										comparisonUris.previous,
									);
								} else {
									void showCommitHasNoPreviousCommitWarningMessage(blame.commit);
									return undefined;
								}
							} else {
								const previousSha = blame != null ? await blame?.commit.getPreviousSha() : undefined;
								if (previousSha != null) {
									args.revisionUri = this.container.git.getRevisionUriFromGitUri(
										blame.commit.getGitUri(true),
									);
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

	async execute(editor: TextEditor | undefined, uri?: Uri, args?: OpenFileAtRevisionCommandArgs): Promise<void> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		args = { ...args };
		args.range ??= selectionToDiffRange(editor?.selection);

		const svc = this.container.git.getRepositoryService(gitUri.repoPath!);
		try {
			if (args.revisionUri == null) {
				const log = svc.commits
					.getLogForPath(gitUri.fsPath, undefined, { isFolder: false })
					.then(
						log =>
							log ??
							(gitUri.sha
								? svc.commits.getLogForPath(gitUri.fsPath, gitUri.sha, { isFolder: false })
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
														'gitlens.openFileRevision',
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
								await openFileAtRevision(item.item.file!, item.item, {
									annotationType: args.annotationType,
									line: diffRangeToEditorLine(args.range),
									preserveFocus: true,
									preview: true,
								});
							},
						},
						showOtherReferences: [
							CommandQuickPickItem.fromCommand<[Uri]>(
								'Choose a Branch or Tag...',
								'gitlens.openFileRevisionFrom',
								[uri],
							),
							CommandQuickPickItem.fromCommand<[Uri, OpenFileAtRevisionFromCommandArgs]>(
								'Choose a Stash...',
								'gitlens.openFileRevisionFrom',
								[uri, { stash: true }],
							),
						],
					},
				);
				if (pick?.file == null) return;

				await openFileAtRevision(pick.file, pick, {
					annotationType: args.annotationType,
					line: diffRangeToEditorLine(args.range),
					...args.showOptions,
				});

				return;
			}

			await openFileAtRevision(args.revisionUri, {
				annotationType: args.annotationType,
				line: diffRangeToEditorLine(args.range),
				...args.showOptions,
			});
		} catch (ex) {
			Logger.error(ex, 'OpenFileAtRevisionCommand');
			void showGenericErrorMessage('Unable to open file at revision');
		}
	}
}
