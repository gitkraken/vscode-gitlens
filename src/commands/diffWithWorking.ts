import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { createReference } from '../git/models/reference.utils';
import { deletedOrMissing, uncommittedStaged } from '../git/models/revision';
import { showGenericErrorMessage } from '../messages';
import { showRevisionFilesPicker } from '../quickpicks/revisionFilesPicker';
import { Logger } from '../system/logger';
import { command, executeCommand } from '../system/vscode/command';
import { findOrOpenEditor } from '../system/vscode/utils';
import { ActiveEditorCommand, getCommandUri } from './base';
import type { DiffWithCommandArgs } from './diffWith';

export interface DiffWithWorkingCommandArgs {
	inDiffRightEditor?: boolean;
	uri?: Uri;
	line?: number;
	showOptions?: TextDocumentShowOptions;
	lhsTitle?: string;
}

@command()
export class DiffWithWorkingCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([GlCommand.DiffWithWorking, GlCommand.DiffWithWorkingInDiffLeft, GlCommand.DiffWithWorkingInDiffRight]);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithWorkingCommandArgs): Promise<any> {
		args = { ...args };
		if (args.uri == null) {
			uri = getCommandUri(uri, editor);
			if (uri == null) return;
		} else {
			uri = args.uri;
		}

		let gitUri = await GitUri.fromUri(uri);

		if (args.line == null) {
			args.line = editor?.selection.active.line ?? 0;
		}

		if (args.inDiffRightEditor) {
			try {
				const diffUris = await this.container.git.getPreviousComparisonUris(
					gitUri.repoPath!,
					gitUri,
					gitUri.sha,
				);
				gitUri = diffUris?.previous ?? gitUri;
			} catch (ex) {
				Logger.error(
					ex,
					'DiffWithWorkingCommand',
					`getPreviousDiffUris(${gitUri.repoPath}, ${gitUri.fsPath}, ${gitUri.sha})`,
				);
				void showGenericErrorMessage('Unable to open compare');

				return;
			}
		}

		// If the sha is missing, just let the user know the file matches
		if (gitUri.sha == null) {
			void window.showInformationMessage('File matches the working tree');

			return;
		}
		if (gitUri.sha === deletedOrMissing) {
			void window.showWarningMessage('Unable to open compare. File has been deleted from the working tree');

			return;
		}

		// If we are a fake "staged" sha, check the status
		if (gitUri.isUncommittedStaged) {
			const status = await this.container.git.getStatusForFile(gitUri.repoPath!, gitUri);
			if (status?.indexStatus != null) {
				void (await executeCommand<DiffWithCommandArgs>(GlCommand.DiffWith, {
					repoPath: gitUri.repoPath,
					lhs: {
						sha: uncommittedStaged,
						uri: gitUri.documentUri(),
					},
					rhs: {
						sha: '',
						uri: gitUri.documentUri(),
					},
					line: args.line,
					showOptions: args.showOptions,
				}));

				return;
			}
		}

		uri = gitUri.toFileUri();

		let workingUri = await this.container.git.getWorkingUri(gitUri.repoPath!, uri);
		if (workingUri == null) {
			const pickedUri = await showRevisionFilesPicker(this.container, createReference('HEAD', gitUri.repoPath!), {
				ignoreFocusOut: true,
				initialPath: gitUri.relativePath,
				title: `Open File \u2022 Unable to open '${gitUri.relativePath}'`,
				placeholder: 'Choose another working file to open',
				keyboard: {
					keys: ['right', 'alt+right', 'ctrl+right'],
					onDidPressKey: async (_key, uri) => {
						await findOrOpenEditor(uri, { ...args.showOptions, preserveFocus: true, preview: true });
					},
				},
			});
			if (pickedUri == null) return;

			workingUri = pickedUri;
		}

		void (await executeCommand<DiffWithCommandArgs>(GlCommand.DiffWith, {
			repoPath: gitUri.repoPath,
			lhs: {
				sha: gitUri.sha,
				uri: uri,
				title: args?.lhsTitle,
			},
			rhs: {
				sha: '',
				uri: workingUri,
			},
			line: args.line,
			showOptions: args.showOptions,
		}));
	}
}
