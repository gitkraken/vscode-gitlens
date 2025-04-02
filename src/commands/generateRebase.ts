import type { CancellationToken, ProgressOptions } from 'vscode';
import { ProgressLocation, window, workspace } from 'vscode';
import type { Source } from '../constants.telemetry';
import type { Container } from '../container';
import type { GitReference } from '../git/models/reference';
import type { Repository } from '../git/models/repository';
import { createReference } from '../git/utils/reference.utils';
import { showGenericErrorMessage } from '../messages';
import { showComparisonPicker } from '../quickpicks/comparisonPicker';
import { command } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { GlCommandBase } from './commandBase';

export interface GenerateRebaseCommandArgs {
	repoPath?: string;
	head?: GitReference;
	base?: GitReference;
	source?: Source;
}

@command()
export class GenerateChangelogCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.ai.generateRebase');
	}

	async execute(args?: GenerateRebaseCommandArgs): Promise<void> {
		try {
			const result = await showComparisonPicker(this.container, args?.repoPath, {
				head: args?.head,
				base: args?.base,
				getTitleAndPlaceholder: step => {
					switch (step) {
						case 1:
							return {
								title: 'Rebase with AI',
								placeholder: 'Choose a reference (branch, tag, etc) to rebase',
							};
						case 2:
							return {
								title: `Rebase with AI \u2022 Select Base to Start From`,
								placeholder: 'Choose a base reference (branch, tag, etc) to rebase from',
							};
					}
				},
			});
			if (result == null) return;

			const mergeBase = await this.container.git
				.refs(result.repoPath)
				.getMergeBase(result.head.ref, result.base.ref);

			const repo = this.container.git.getRepository(result.repoPath)!;

			await generateRebase(
				this.container,
				repo,
				result.head,
				mergeBase ? createReference(mergeBase, result.repoPath, { refType: 'revision' }) : result.base,
				args?.source ?? { source: 'commandPalette' },
				{ progress: { location: ProgressLocation.Notification } },
			);
		} catch (ex) {
			Logger.error(ex, 'GenerateRebaseCommand', 'execute');
			void showGenericErrorMessage('Unable to generate rebase');
		}
	}
}

export async function generateRebase(
	container: Container,
	repo: Repository,
	head: GitReference,
	base: GitReference,
	source: Source,
	options?: { cancellation?: CancellationToken; progress?: ProgressOptions },
): Promise<void> {
	const result = await container.ai.generateRebase(repo, base.ref, head.ref, source, options);

	// open an untitled editor
	const document = await workspace.openTextDocument({ language: 'markdown', content: result?.content ?? '' });
	await window.showTextDocument(document);
}
