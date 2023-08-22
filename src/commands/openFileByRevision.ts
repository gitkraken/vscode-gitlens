import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import type { FileAnnotationType } from '../config';
import { Commands } from '../constants';
import type { Container } from '../container';
import { openFileAtRevision, pickFileAtRevision } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import { showNoRepositoryWarningMessage } from '../messages';
import { showReferencePicker } from '../quickpicks/referencePicker';
import { command } from '../system/command';
import { ActiveEditorCommand, getCommandUri } from './base';

export interface OpenFileByRevisionCommandArgs {
	revisionUri?: Uri;

	line?: number;
	showOptions?: TextDocumentShowOptions;
	annotationType?: FileAnnotationType;
}

@command()
export class OpenFileByRevisionCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			Commands.OpenFileByRevision /*, Commands.OpenFileByRevisionInDiffLeft, Commands.OpenFileByRevisionInDiffRight*/,
		]);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenFileByRevisionCommandArgs) {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);
		if (!gitUri.repoPath) {
			void showNoRepositoryWarningMessage('Unable to determine repository path');
			return;
		}

		args = { ...args };

		if (args.revisionUri == null) {
			let resolveKeyboardPickPromise: (reference: Uri) => void;
			const keyboardPickPromise = new Promise<Uri>(resolve => { resolveKeyboardPickPromise = resolve; });
			const referencePickPromise = showReferencePicker(
				gitUri.repoPath,
				`Select Branch or Tag to browse for File`,
				'Choose a branch or tag',
				{
					allowEnteringRefs: true,
					keys: ['right', 'alt+right', 'ctrl+right'],
					onDidPressKey: (key, quickpick) => {
						const [item] = quickpick.activeItems;
						if (item != null) {
							const refUri = this.container.git.getRevisionUri(item.ref, gitUri.fsPath, gitUri.repoPath!);
							resolveKeyboardPickPromise(refUri);
						}
					},
				},
			).then(commit => {
				return commit ? new GitUri(gitUri, commit) : undefined;
			});
			const revision = await Promise.race([keyboardPickPromise, referencePickPromise]);
			if (revision == null) return;
			args.revisionUri = revision;
		}

		const revUri = await GitUri.fromUri(args.revisionUri);
		const file = await pickFileAtRevision(revUri, {
			title: 'Select File to open',
			initialPath: gitUri.relativePath,
		});

		if (!file) return;

		await openFileAtRevision(file, {
			annotationType: args.annotationType,
			line: args.line,
			...args.showOptions,
		});
	}
}
