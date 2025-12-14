import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { GlyphChars, quickPickTitleMaxChars } from '../constants';
import type { Container } from '../container';
import type { DiffRange } from '../git/gitProvider';
import { GitUri } from '../git/gitUri';
import { isBranchReference } from '../git/utils/reference.utils';
import { shortenRevision } from '../git/utils/revision.utils';
import { showNoRepositoryWarningMessage } from '../messages';
import { showReferencePicker } from '../quickpicks/referencePicker';
import { showStashPicker } from '../quickpicks/stashPicker';
import { command, executeCommand } from '../system/-webview/command';
import { selectionToDiffRange } from '../system/-webview/vscode/editors';
import { basename } from '../system/path';
import { pad } from '../system/string';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { DiffWithCommandArgs } from './diffWith';

export interface DiffWithRevisionFromCommandArgs {
	stash?: boolean;

	range?: DiffRange;
	showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithRevisionFromCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.diffWithRevisionFrom');
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithRevisionFromCommandArgs): Promise<void> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		const gitUri = await GitUri.fromUri(uri);
		if (!gitUri.repoPath) {
			void showNoRepositoryWarningMessage('Unable to open file comparison');

			return;
		}

		args = { ...args };
		args.range ??= selectionToDiffRange(editor?.selection);

		const svc = this.container.git.getRepositoryService(gitUri.repoPath);
		const path = svc.getRelativePath(gitUri, gitUri.repoPath);

		let ref;
		let sha;
		if (args?.stash) {
			const title = `Open Changes with Stash${pad(GlyphChars.Dot, 2, 2)}`;
			const pick = await showStashPicker(
				svc.stash?.getStash(),
				`${title}${gitUri.getFormattedFileName({ truncateTo: quickPickTitleMaxChars - title.length })}`,
				'Choose a stash to compare with',
				{
					empty: `No stashes with '${gitUri.getFormattedFileName()}' found`,
					// Stashes should always come with files, so this should be fine (but protect it just in case)
					filter: c => c.anyFiles?.some(f => f.path === path || f.originalPath === path) ?? true,
				},
			);
			if (pick == null) return;

			ref = pick.ref;
			sha = ref;
		} else {
			const title = `Open Changes with Branch or Tag${pad(GlyphChars.Dot, 2, 2)}`;
			const pick = await showReferencePicker(
				gitUri.repoPath,
				`${title}${gitUri.getFormattedFileName({ truncateTo: quickPickTitleMaxChars - title.length })}`,
				'Choose a reference (branch, tag, etc) to compare with',
				{
					allowedAdditionalInput: { rev: true },
				},
			);
			if (pick == null) return;

			ref = pick.ref;
			sha = isBranchReference(pick) && pick.remote ? `remotes/${ref}` : ref;
		}

		if (ref == null) return;

		let renamedUri: Uri | undefined;
		let renamedTitle: string | undefined;

		// Check to see if this file has been renamed
		const files = await svc.diff.getDiffStatus('HEAD', ref, { filters: ['R', 'C'] });
		if (files != null) {
			const rename = files.find(s => s.path === path);
			if (rename?.originalPath != null) {
				renamedUri = svc.getAbsoluteUri(rename.originalPath, gitUri.repoPath);
				renamedTitle = `${basename(rename.originalPath)} (${shortenRevision(ref)})`;
			}
		}

		void (await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
			repoPath: gitUri.repoPath,
			lhs: {
				sha: sha,
				uri: renamedUri ?? gitUri,
				title: renamedTitle ?? `${basename(gitUri.fsPath)} (${shortenRevision(ref)})`,
			},
			rhs: { sha: '', uri: gitUri },
			range: args.range,
			showOptions: args.showOptions,
		}));
	}
}
