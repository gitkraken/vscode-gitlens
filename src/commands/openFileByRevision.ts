import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import type { FileAnnotationType } from '../config';
import { Commands } from '../constants';
import { Container } from '../container';
import { openFileAtRevision } from '../git/actions/commit';
import { GitUri } from '../git/gitUri';
import { showNoRepositoryWarningMessage } from '../messages';
import { showReferencePicker } from '../quickpicks/referencePicker';
import { showRevisionPicker } from '../quickpicks/revisionPicker';
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
			// TODO: Do we want to support these command variations?
			Commands.OpenFileByRevision /*, Commands.OpenFileByRevisionInDiffLeft, Commands.OpenFileByRevisionInDiffRight*/,
		]);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: OpenFileByRevisionCommandArgs) {
		uri = getCommandUri(uri, editor);
		const gitUri = uri ? await GitUri.fromUri(uri) : undefined;
		// TODO: Should we ask user to select repository if there are multiple in the workspace?
		const repoPath = gitUri?.repoPath || this.container.git.getBestRepository()?.path

		if (!repoPath) {
			void showNoRepositoryWarningMessage('Unable to determine repository path');
			return
		}

		args = {...args}

		let revisionUri = args.revisionUri
		if (revisionUri == null) {
			const pick = await showReferencePicker(
				repoPath,
				`Select Branch or Tag to browse for File`,
				'Choose a branch or tag',
				// TODO: This option appears to have been removed?
				// { allowEnteringRefs: true },
			);
			if (pick == null) return;
			revisionUri = GitUri.fromRepoPath(repoPath, pick.ref)
		}

		const revisionGitUri = await GitUri.fromUri(revisionUri);
		const file = await showRevisionPicker(Container.instance, revisionGitUri, {
			title: 'Select File to open',
		});

		if (!file) return;

		await openFileAtRevision(file, {
			annotationType: args.annotationType,
			line: args.line,
			...args.showOptions,
		});
	}
}
