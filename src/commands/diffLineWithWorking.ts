import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import type { Container } from '../container';
import type { DiffRange } from '../git/gitProvider';
import { GitUri } from '../git/gitUri';
import type { GitCommit } from '../git/models/commit';
import { uncommittedStaged } from '../git/models/revision';
import { showFileNotUnderSourceControlWarningMessage, showGenericErrorMessage } from '../messages';
import { command, executeCommand } from '../system/-webview/command';
import { diffRangeToEditorLine, selectionToDiffRange } from '../system/-webview/vscode/editors';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';
import type { DiffWithCommandArgs } from './diffWith';

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
			args = { ...args, range: { startLine: context.line, endLine: context.line } };
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
				args.range = { startLine: blame.line.line, endLine: blame.line.line };
			} catch (ex) {
				Logger.error(ex, 'DiffLineWithWorkingCommand', `getBlameForLine(${blameEditorLine})`);
				void showGenericErrorMessage('Unable to open compare');

				return;
			}
		} else {
			lhsSha = args.commit.sha;
			lhsUri = args.commit.file?.uri ?? gitUri;
		}

		const workingUri = await args.commit.file?.getWorkingUri();
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
