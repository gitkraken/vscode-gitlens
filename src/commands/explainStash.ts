import type { TextEditor, Uri } from 'vscode';
import { ProgressLocation } from 'vscode';
import type { Container } from '../container';
import { GitUri } from '../git/gitUri';
import type { GitCommit, GitStashCommit } from '../git/models/commit';
import { showGenericErrorMessage } from '../messages';
import type { AIExplainSource } from '../plus/ai/aiProviderService';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { showStashPicker } from '../quickpicks/stashPicker';
import { command } from '../system/-webview/command';
import { showMarkdownPreview } from '../system/-webview/markdown';
import { Logger } from '../system/logger';
import { GlCommandBase } from './commandBase';
import { getCommandUri } from './commandBase.utils';
import type { CommandContext } from './commandContext';
import { isCommandContextViewNodeHasCommit } from './commandContext.utils';

export interface ExplainStashCommandArgs {
	repoPath?: string | Uri;
	rev?: string;
	source?: AIExplainSource;
}

@command()
export class ExplainStashCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.ai.explainStash', 'gitlens.ai.explainStash:views']);
	}

	protected override preExecute(context: CommandContext, args?: ExplainStashCommandArgs): Promise<void> {
		// Check if the command is being called from a CommitNode
		if (isCommandContextViewNodeHasCommit<GitStashCommit>(context)) {
			args = { ...args };
			args.repoPath = args.repoPath ?? context.node.commit.repoPath;
			args.rev = args.rev ?? context.node.commit.sha;
			args.source = args.source ?? { source: 'view', type: 'stash' };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ExplainStashCommandArgs): Promise<void> {
		args = { ...args };

		let repository;
		if (args?.repoPath != null) {
			repository = this.container.git.getRepository(args.repoPath);
		}

		if (repository == null) {
			uri = getCommandUri(uri, editor);
			const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;
			repository = await getBestRepositoryOrShowPicker(
				gitUri,
				editor,
				'Explain Stash Changes',
				'Choose which repository to explain a stash from',
			);
		}

		if (repository == null) return;

		try {
			let commit: GitCommit | undefined;
			if (args.rev == null) {
				const pick = await showStashPicker(
					repository.git.stash?.getStash(),
					'Explain Stash Changes',
					'Choose a stash to explain',
				);
				if (pick?.ref == null) return;
				args.rev = pick.ref;
				commit = pick;
			} else {
				commit = await repository.git.commits.getCommit(args.rev);
				if (commit == null) {
					void showGenericErrorMessage('Unable to find the specified stash commit');
					return;
				}
			}

			const result = await this.container.ai.explainCommit(
				commit,
				{
					...args.source,
					source: args.source?.source ?? 'commandPalette',
					type: 'stash',
				},
				{
					progress: { location: ProgressLocation.Notification, title: 'Explaining stash...' },
				},
			);

			if (result == null) {
				void showGenericErrorMessage('No changes found to explain for stash');
				return;
			}

			// Display the result
			const content = `# Stash Summary\n\n> Generated by ${result.model.name}\n\n## ${
				commit.message || commit.ref
			}\n\n${result.parsed.summary}\n\n${result.parsed.body}`;

			void showMarkdownPreview(content);
		} catch (ex) {
			Logger.error(ex, 'ExplainStashCommand', 'execute');
			void showGenericErrorMessage('Unable to explain stash');
		}
	}
}
