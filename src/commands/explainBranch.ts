import type { TextEditor, Uri } from 'vscode';
import { ProgressLocation } from 'vscode';
import type { Container } from '../container';
import type { GitBranchReference } from '../git/models/reference';
import { getBranchMergeTargetName } from '../git/utils/-webview/branch.utils';
import { showGenericErrorMessage } from '../messages';
import { prepareCompareDataForAIRequest } from '../plus/ai/aiProviderService';
import { ReferencesQuickPickIncludes, showReferencePicker } from '../quickpicks/referencePicker';
import { command } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { getNodeRepoPath } from '../views/nodes/abstract/viewNode';
import type { CommandContext } from './commandContext';
import { isCommandContextViewNodeHasBranch } from './commandContext.utils';
import type { ExplainBaseArgs } from './explainBase';
import { ExplainCommandBase } from './explainBase';

export interface ExplainBranchCommandArgs extends ExplainBaseArgs {
	ref?: string;
	baseBranch?: string;
}

@command()
export class ExplainBranchCommand extends ExplainCommandBase {
	pickerTitle = 'Explain Branch Changes';
	repoPickerPlaceholder = 'Choose which repository to explain a branch from';

	constructor(container: Container) {
		super(container, ['gitlens.ai.explainBranch', 'gitlens.ai.explainBranch:views']);
	}

	protected override preExecute(context: CommandContext, args?: ExplainBranchCommandArgs): Promise<void> {
		if (isCommandContextViewNodeHasBranch(context)) {
			args = { ...args };
			args.repoPath = args.repoPath ?? getNodeRepoPath(context.node);
			args.ref = args.ref ?? context.node.branch.ref;
			args.source = args.source ?? { source: 'view', context: { type: 'branch' } };
		}

		return this.execute(context.editor, context.uri, args);
	}

	async execute(editor?: TextEditor, uri?: Uri, args?: ExplainBranchCommandArgs): Promise<void> {
		args = { ...args };

		const svc = await this.getRepositoryService(editor, uri, args);
		if (svc == null) {
			void showGenericErrorMessage('Unable to find a repository');
			return;
		}

		try {
			// Clarifying the head branch
			if (args.ref == null) {
				// If no ref is provided, show a picker to select a branch
				const pick = (await showReferencePicker(svc.path, this.pickerTitle, 'Choose a branch to explain', {
					include: ReferencesQuickPickIncludes.Branches,
					sort: { branches: { current: true } },
				})) as GitBranchReference | undefined;
				if (pick?.ref == null) return;
				args.ref = pick.ref;
			}

			// Get the branch
			const branch = await svc.branches.getBranch(args.ref);
			if (branch == null) {
				void showGenericErrorMessage('Unable to find the specified branch');
				return;
			}

			// Clarifying the base branch
			let baseBranch;
			if (args.baseBranch) {
				// Use the provided base branch
				baseBranch = await svc.branches.getBranch(args.baseBranch);
				if (!baseBranch) {
					void showGenericErrorMessage(`Unable to find the specified base branch: ${args.baseBranch}`);
					return;
				}
			} else {
				// Fall back to automatic merge target detection
				const baseBranchNameResult = await getBranchMergeTargetName(this.container, branch);
				if (!baseBranchNameResult.paused) {
					baseBranch = await svc.branches.getBranch(baseBranchNameResult.value);
				}

				if (!baseBranch) {
					void showGenericErrorMessage(`Unable to find the base branch for branch ${branch.name}.`);
					return;
				}
			}

			// Get the diff between the branch and its upstream or base
			const compareData = await prepareCompareDataForAIRequest(svc, branch.ref, baseBranch.ref, {
				reportNoDiffService: () => void showGenericErrorMessage('Unable to get diff service'),
				reportNoCommitsService: () => void showGenericErrorMessage('Unable to get commits service'),
				reportNoChanges: () => void showGenericErrorMessage('No changes found to explain'),
			});

			if (compareData == null) {
				return;
			}

			const { diff, logMessages } = compareData;

			const changes = {
				diff: diff,
				message: `Changes in branch ${branch.name}
					that is ahead of its target by number of commits with the following messages:\n\n
					<commits>
					${logMessages}
					<end-of-commits>
					`,
			};

			// Call the AI service to explain the changes
			const result = await this.container.ai.explainChanges(
				changes,
				{
					...args.source,
					source: args.source?.source ?? 'commandPalette',
					context: { type: 'branch' },
				},
				{
					progress: { location: ProgressLocation.Notification, title: 'Explaining branch changes...' },
				},
			);

			if (result === 'cancelled') return;

			if (result == null) {
				void showGenericErrorMessage(`Unable to explain branch ${branch.name}`);
				return;
			}

			const { promise, model } = result;
			this.openDocument(promise, `/explain/branch/${branch.ref}/${model.id}`, model, 'explain-branch', {
				header: { title: 'Branch Summary', subtitle: branch.name },
				command: {
					label: 'Explain Branch Changes',
					name: 'gitlens.ai.explainBranch',
					args: { repoPath: svc.path, ref: branch.ref, source: args.source },
				},
			});
		} catch (ex) {
			Logger.error(ex, 'ExplainBranchCommand', 'execute');
			void showGenericErrorMessage('Unable to explain branch');
		}
	}
}
