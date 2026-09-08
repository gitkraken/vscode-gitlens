import type { TextEditor, Uri } from 'vscode';
import { l10n, ProgressLocation } from 'vscode';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import { Logger } from '@gitlens/utils/logger.js';
import { capitalize } from '@gitlens/utils/string.js';
import type { Container } from '../container.js';
import { showGenericErrorMessage } from '../messages.js';
import { command } from '../system/-webview/command.js';
import { createMarkdownCommandLink } from '../system/commands.js';
import type { CommandContext } from './commandContext.js';
import {
	isCommandContextViewNodeHasRepoPath,
	isCommandContextViewNodeHasRepository,
	isCommandContextViewNodeHasWorktree,
} from './commandContext.utils.js';
import type { ExplainBaseArgs } from './explainBase.js';
import { ExplainCommandBase } from './explainBase.js';

export interface ExplainWipCommandArgs extends ExplainBaseArgs {
	staged?: boolean;
	prompt?: string;
}

@command()
export class ExplainWipCommand extends ExplainCommandBase {
	static createMarkdownCommandLink(args: ExplainWipCommandArgs): string {
		return createMarkdownCommandLink<ExplainWipCommandArgs>('gitlens.ai.explainWip:editor', args);
	}

	pickerTitle = l10n.t('Explain Working Changes');
	repoPickerPlaceholder = l10n.t('Choose which repository to explain working changes from');

	constructor(container: Container) {
		super(container, ['gitlens.ai.explainWip', 'gitlens.ai.explainWip:editor', 'gitlens.ai.explainWip:views']);
	}

	protected override preExecute(context: CommandContext, args?: ExplainWipCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasWorktree(context)) {
			args = { ...args };
			args.repoPath = context.node.worktree.repoPath;
			args.worktreePath = context.node.worktree.path;
			args.source = args.source ?? { source: 'view', context: { type: 'wip' } };
		} else if (isCommandContextViewNodeHasRepository(context)) {
			args = { ...args };
			args.repoPath = context.node.repo.path;
			args.source = args.source ?? { source: 'view', context: { type: 'wip' } };
		} else if (isCommandContextViewNodeHasRepoPath(context)) {
			args = { ...args };
			args.repoPath = context.node.repoPath;
			args.source = args.source ?? { source: 'view', context: { type: 'wip' } };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ExplainWipCommandArgs): Promise<void> {
		args = { ...args };

		// Get the diff of working changes
		const svc = await this.getRepositoryService(editor, uri, args);
		if (svc?.diff?.getDiff == null) {
			void showGenericErrorMessage(l10n.t('Unable to get diff service'));
			return;
		}

		args.repoPath ??= svc.path;

		let label;
		let to;
		if (args?.staged === true) {
			label = 'staged';
			to = uncommittedStaged;
		} else if (args?.staged === false) {
			label = 'unstaged';
			to = uncommitted;
		} else {
			label = 'working';
			to = '';
		}

		let repoName = svc.getRepository()?.name ?? svc.path;
		try {
			const diff = await svc.diff.getDiff(to, undefined);
			if (!diff?.contents) {
				const message =
					args.staged === true
						? l10n.t('No staged changes found to explain')
						: args.staged === false
							? l10n.t('No unstaged changes found to explain')
							: l10n.t('No working changes found to explain');
				void showGenericErrorMessage(message);
				return;
			}

			if (args?.worktreePath) {
				// Get the worktree name if available
				const worktrees = await svc.worktrees?.getWorktrees();
				const worktree = worktrees?.find(w => w.path === args.worktreePath);

				repoName = worktree?.name ?? args.worktreePath.toString();
			}

			// Call the AI service to explain the changes
			const result = await this.container.ai.actions.explainChanges(
				{
					diff: diff.contents,
					message: `${capitalize(label)} changes in ${repoName}`,
					instructions: args.prompt,
				},
				{
					...args.source,
					source: args.source?.source ?? 'commandPalette',
					context: { type: 'wip' },
				},
				{
					progress: {
						location: ProgressLocation.Notification,
						title:
							args.staged === true
								? l10n.t('Explaining staged changes in {0}...', repoName)
								: args.staged === false
									? l10n.t('Explaining unstaged changes in {0}...', repoName)
									: l10n.t('Explaining working changes in {0}...', repoName),
					},
				},
			);

			if (result === 'cancelled') return;

			if (result == null) {
				const message =
					args.staged === true
						? l10n.t('Unable to explain staged changes')
						: args.staged === false
							? l10n.t('Unable to explain unstaged changes')
							: l10n.t('Unable to explain working changes');
				void showGenericErrorMessage(message);
				return;
			}

			const { promise, model } = result;
			const header =
				args.staged === true
					? {
							title: l10n.t('Staged Changes Summary'),
							subtitle: l10n.t('Staged Changes ({0})', repoName),
							commandLabel: l10n.t('Explain Staged Changes'),
						}
					: args.staged === false
						? {
								title: l10n.t('Unstaged Changes Summary'),
								subtitle: l10n.t('Unstaged Changes ({0})', repoName),
								commandLabel: l10n.t('Explain Unstaged Changes'),
							}
						: {
								title: l10n.t('Working Changes Summary'),
								subtitle: l10n.t('Working Changes ({0})', repoName),
								commandLabel: l10n.t('Explain Working Changes'),
							};
			this.openDocument(promise, `/explain/wip/${svc.path}/${model.id}`, model, 'explain-wip', {
				header: {
					title: header.title,
					subtitle: header.subtitle,
				},
				command: {
					label: header.commandLabel,
					name: 'gitlens.ai.explainWip',
					args: { ...args },
				},
			});
		} catch (ex) {
			Logger.error(ex, 'ExplainWipCommand', 'execute');
			const message =
				args.staged === true
					? l10n.t('Unable to explain staged changes')
					: args.staged === false
						? l10n.t('Unable to explain unstaged changes')
						: l10n.t('Unable to explain working changes');
			void showGenericErrorMessage(message);
		}
	}
}
