import type { TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { l10n } from 'vscode';
import type { DiffRange } from '@gitlens/git/providers/types.js';
import { isBranchReference } from '@gitlens/git/utils/reference.utils.js';
import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { basename } from '@gitlens/utils/path.js';
import { pad } from '@gitlens/utils/string.js';
import { GlyphChars, quickPickTitleMaxChars } from '../constants.js';
import type { Container } from '../container.js';
import { GitUri } from '../git/gitUri.js';
import { showNoRepositoryWarningMessage } from '../messages.js';
import { showReferencePicker } from '../quickpicks/referencePicker.js';
import { showStashPicker } from '../quickpicks/stashPicker.js';
import { command, executeCommand } from '../system/-webview/command.js';
import { resolveDiffRange } from '../system/-webview/vscode/range.js';
import { ActiveEditorCommand } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';
import type { DiffWithCommandArgs } from './diffWith.js';

export interface DiffWithRevisionFromCommandArgs {
	stash?: boolean;

	/** Use `null` to explicitly open without a selection, so the diff editor reveals the first change */
	range?: DiffRange | null;
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
			void showNoRepositoryWarningMessage(l10n.t('Unable to open file comparison'));

			return;
		}

		args = { ...args };
		args.range = resolveDiffRange(args.range, editor);

		const svc = this.container.git.getRepositoryService(gitUri.repoPath);
		const path = svc.getRelativePath(gitUri, gitUri.repoPath);

		let ref;
		let sha;
		if (args?.stash) {
			const title = l10n.t('Open Changes with Stash');
			const titleSeparator = pad(GlyphChars.Dot, 2, 2);
			const titleFileName = gitUri.getFormattedFileName({
				truncateTo: quickPickTitleMaxChars - title.length - titleSeparator.length,
			});
			const pick = await showStashPicker(
				svc.stash?.getStash(),
				l10n.t('Open Changes with Stash{0}{1}', titleSeparator, titleFileName),
				l10n.t('Choose a stash to compare with'),
				{
					empty: l10n.t("No stashes with '{0}' found", gitUri.getFormattedFileName()),
					// Stashes should always come with files, so this should be fine (but protect it just in case)
					filter: c => c.anyFiles?.some(f => f.path === path || f.originalPath === path) ?? true,
				},
			);
			if (pick == null) return;

			ref = pick.ref;
			sha = ref;
		} else {
			const title = l10n.t('Open Changes with Branch or Tag');
			const titleSeparator = pad(GlyphChars.Dot, 2, 2);
			const titleFileName = gitUri.getFormattedFileName({
				truncateTo: quickPickTitleMaxChars - title.length - titleSeparator.length,
			});
			const pick = await showReferencePicker(
				gitUri.repoPath,
				l10n.t('Open Changes with Branch or Tag{0}{1}', titleSeparator, titleFileName),
				l10n.t('Choose a reference (branch, tag, etc) to compare with'),
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
				renamedTitle = l10n.t('{0} ({1})', basename(rename.originalPath), shortenRevision(ref));
			}
		}
		const title = renamedTitle ?? l10n.t('{0} ({1})', basename(gitUri.fsPath), shortenRevision(ref));

		void (await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
			repoPath: gitUri.repoPath,
			lhs: {
				sha: sha,
				uri: renamedUri ?? gitUri,
				title: title,
			},
			rhs: { sha: '', uri: gitUri },
			range: args.range,
			showOptions: args.showOptions,
		}));
	}
}
