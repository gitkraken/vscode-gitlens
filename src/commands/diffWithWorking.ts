import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import { deletedOrMissing, uncommittedStaged } from '../git/models/revision';
import { createReference } from '../git/utils/reference.utils';
import { showGenericErrorMessage } from '../messages';
import { showRevisionFilesPicker } from '../quickpicks/revisionFilesPicker';
import { command, executeCommand } from '../system/-webview/command';
import { getOrOpenTextEditor } from '../system/-webview/vscode/editors';
import { getTabUris, getVisibleTabs } from '../system/-webview/vscode/tabs';
import { Logger } from '../system/logger';
import { uriEquals } from '../system/uri';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { DiffWithCommandArgs } from './diffWith';

export interface DiffWithWorkingCommandArgs {
	uri?: Uri;
	line?: number;
	showOptions?: TextDocumentShowOptions;
	lhsTitle?: string;
}

@command()
export class DiffWithWorkingCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.diffWithWorking');
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

		let isInRightSideOfDiffEditor = false;

		// Figure out if we are in a diff editor and if so, which side
		const [tab] = getVisibleTabs(uri);
		if (tab != null) {
			const uris = getTabUris(tab);
			// If there is an original, then we are in a diff editor -- modified is right, original is left
			if (uris.original != null && uriEquals(uri, uris.modified)) {
				isInRightSideOfDiffEditor = true;
			}
		}

		if (isInRightSideOfDiffEditor) {
			try {
				const diffUris = await this.container.git
					.diff(gitUri.repoPath!)
					.getPreviousComparisonUris(gitUri, gitUri.sha);
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
			const status = await this.container.git.status(gitUri.repoPath!).getStatusForFile?.(gitUri);
			if (status?.indexStatus != null) {
				void (await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
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
						await getOrOpenTextEditor(uri, { ...args.showOptions, preserveFocus: true, preview: true });
					},
				},
			});
			if (pickedUri == null) return;

			workingUri = pickedUri;
		}

		void (await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
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
