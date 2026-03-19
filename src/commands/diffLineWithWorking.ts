import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import type { GitCommit } from '@gitlens/git/models/commit.js';
import { uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { DiffRange } from '@gitlens/git/providers/types.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../container.js';
import { GitUri } from '../git/gitUri.js';
import { getFileChangeWorkingUri } from '../git/utils/-webview/fileChange.utils.js';
import { showFileNotUnderSourceControlWarningMessage, showGenericErrorMessage } from '../messages.js';
import { command, executeCommand } from '../system/-webview/command.js';
import { diffRangeToEditorLine, selectionToDiffRange } from '../system/-webview/vscode/range.js';
import { ActiveEditorCommand } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';
import type { CommandContext } from './commandContext.js';
import type { DiffWithCommandArgs } from './diffWith.js';

export interface DiffLineWithWorkingCommandArgs {
	commit?: GitCommit;

	range?: DiffRange;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffLineWithWorkingCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.diffLineWithWorking');
	}

	protected override preExecute(context: CommandContext, args?: DiffLineWithWorkingCommandArgs): Promise<any> {
		if (context.type === 'editorLine') {
			args = {
				...args,
				range: { startLine: context.line, startCharacter: 1, endLine: context.line, endCharacter: 1 },
			};
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffLineWithWorkingCommandArgs): Promise<any> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);

		args = { ...args };
		args.range ??= selectionToDiffRange(editor?.selection);

		let lhsSha: string;
		let lhsUri: Uri;

		if (args.commit == null || args.commit.isUncommitted) {
			const blameEditorLine = diffRangeToEditorLine(args.range);
			if (blameEditorLine < 0) return;

			try {
				const blame = await this.container.git.getBlameForLine(gitUri, blameEditorLine, editor?.document);
				if (blame == null) {
					void showFileNotUnderSourceControlWarningMessage('Unable to open compare');

					return;
				}

				args.commit = blame.commit;

				// If the line is uncommitted, use previous commit (or index if the file is staged)
				if (args.commit.isUncommitted) {
					const svc = this.container.git.getRepositoryService(gitUri.repoPath!);
					const status = await svc.status.getStatusForFile?.(gitUri);
					if (status?.indexStatus != null) {
						lhsSha = uncommittedStaged;
						lhsUri = svc.getAbsoluteUri(status.originalPath || status.path, args.commit.repoPath);
					} else {
						// Don't need to worry about verifying the previous sha, as the DiffWith command will
						lhsSha = args.commit.unresolvedPreviousSha;
						lhsUri = args.commit.file!.originalUri ?? args.commit.file!.uri;
					}
				} else {
					lhsSha = args.commit.sha;
					lhsUri = args.commit.file!.uri;
				}
				args.range = {
					startLine: blame.line.line,
					startCharacter: 1,
					endLine: blame.line.line,
					endCharacter: 1,
				};
			} catch (ex) {
				Logger.error(ex, 'DiffLineWithWorkingCommand', `getBlameForLine(${blameEditorLine})`);
				void showGenericErrorMessage('Unable to open compare');

				return;
			}
		} else {
			lhsSha = args.commit.sha;
			lhsUri = args.commit.file?.uri ?? gitUri;
		}

		const workingUri = args.commit.file != null ? await getFileChangeWorkingUri(args.commit.file) : undefined;
		if (workingUri == null) {
			void window.showWarningMessage('Unable to open compare. File has been deleted from the working tree');

			return;
		}

		void (await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
			repoPath: args.commit.repoPath,
			lhs: { sha: lhsSha, uri: lhsUri },
			rhs: { sha: '', uri: workingUri },
			range: args.range,
			showOptions: args.showOptions,
		}));
	}
}
