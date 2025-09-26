import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import type { Container } from '../container';
import type { DiffRange } from '../git/gitProvider';
import { GitUri } from '../git/gitUri';
import { deletedOrMissing, uncommittedStaged } from '../git/models/revision';
import { createReference } from '../git/utils/reference.utils';
import { showGenericErrorMessage } from '../messages';
import { showRevisionFilesPicker } from '../quickpicks/revisionFilesPicker';
import { command, executeCommand } from '../system/-webview/command';
import { getOrOpenTextEditor, selectionToDiffRange } from '../system/-webview/vscode/editors';
import { getTabUris, getVisibleTabs } from '../system/-webview/vscode/tabs';
import { Logger } from '../system/logger';
import { areUrisEqual } from '../system/uri';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { DiffWithCommandArgs } from './diffWith';

export interface DiffWithWorkingCommandArgs {
	uri?: Uri;

	range?: DiffRange;
	showOptions?: TextDocumentShowOptions;
	lhsTitle?: string;
}

@command()
export class DiffWithWorkingCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			'gitlens.diffWithWorking',
			'gitlens.diffWithWorking:command',
			'gitlens.diffWithWorking:editor',
			'gitlens.diffWithWorking:editor/title',
			'gitlens.diffWithWorking:key',
			'gitlens.diffWithWorking:views',
		]);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithWorkingCommandArgs): Promise<any> {
		args = { ...args };
		if (args.uri == null) {
			uri = getCommandUri(uri, editor);
			if (uri == null) return;
		} else {
			uri = args.uri;
		}
		args.range ??= selectionToDiffRange(editor?.selection);

		let gitUri = await GitUri.fromUri(uri);
		let isInRightSideOfDiffEditor = false;

		// Figure out if we are in a diff editor and if so, which side
		const [tab] = getVisibleTabs(uri);
		if (tab != null) {
			const uris = getTabUris(tab);
			// If there is an original, then we are in a diff editor -- modified is right, original is left
			if (uris.original != null && areUrisEqual(uri, uris.modified)) {
				isInRightSideOfDiffEditor = true;
			}
		}

		const svc = this.container.git.getRepositoryService(gitUri.repoPath!);

		if (isInRightSideOfDiffEditor) {
			try {
				const diffUris = await svc.diff.getPreviousComparisonUris(gitUri, gitUri.sha);
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
			const status = await svc.status.getStatusForFile?.(gitUri, { renames: false });
			if (status?.indexStatus != null) {
				void (await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
					repoPath: gitUri.repoPath,
					lhs: { sha: uncommittedStaged, uri: gitUri.documentUri() },
					rhs: { sha: '', uri: gitUri.documentUri() },
					range: args.range,
					showOptions: args.showOptions,
				}));

				return;
			}
		}

		uri = gitUri.toFileUri();

		let workingUri = await svc.getWorkingUri(uri);
		if (workingUri == null) {
			const picked = await showRevisionFilesPicker(this.container, createReference('HEAD', gitUri.repoPath!), {
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
			if (picked == null) return;

			workingUri = picked?.uri;
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
			range: args.range,
			showOptions: args.showOptions,
		}));
	}
}
