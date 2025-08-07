import type { ConfigurationChangeEvent } from 'vscode';
import { commands, Disposable, ProgressLocation, window } from 'vscode';
import type { ContextKeys } from '../../../constants.context';
import type { WebviewTelemetryContext } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import { createReference } from '../../../git/utils/reference.utils';
import { sendFeedbackEvent, showUnhelpfulFeedbackPicker } from '../../../plus/ai/aiFeedbackUtils';
import type { AIModelChangeEvent } from '../../../plus/ai/aiProviderService';
import { executeCommand } from '../../../system/-webview/command';
import { configuration } from '../../../system/-webview/configuration';
import { getContext, onDidChangeContext } from '../../../system/-webview/context';
import type { IpcMessage } from '../../protocol';
import type { WebviewHost, WebviewProvider } from '../../webviewProvider';
import { mockBaseCommit, mockCommits, mockHunkMap, mockHunks } from './mockData';
import type {
	AIFeedbackParams,
	FinishAndCommitParams,
	GenerateCommitMessageParams,
	GenerateCommitsParams,
	State,
} from './protocol';
import {
	AIFeedbackHelpfulCommand,
	AIFeedbackUnhelpfulCommand,
	CloseComposerCommand,
	DidChangeAiEnabledNotification,
	DidChangeAiModelNotification,
	DidFinishCommittingNotification,
	DidGenerateCommitMessageNotification,
	DidGenerateCommitsNotification,
	DidStartCommittingNotification,
	DidStartGeneratingCommitMessageNotification,
	DidStartGeneratingNotification,
	FinishAndCommitCommand,
	GenerateCommitMessageCommand,
	GenerateCommitsCommand,
	OnSelectAIModelCommand,
} from './protocol';
import type { ComposerWebviewShowingArgs } from './registration';
import { convertToComposerDiffInfo } from './utils';

export class ComposerWebviewProvider implements WebviewProvider<State, State, ComposerWebviewShowingArgs> {
	private readonly _disposable: Disposable;
	private _args?: ComposerWebviewShowingArgs[0];

	constructor(
		protected readonly container: Container,
		protected readonly host: WebviewHost<'gitlens.composer'>,
	) {
		this._disposable = Disposable.from(
			configuration.onDidChangeAny(this.onAnyConfigurationChanged, this),
			onDidChangeContext(this.onContextChanged, this),
			this.container.ai.onDidChangeModel(this.onAIModelChanged, this),
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	onMessageReceived(e: IpcMessage): void {
		switch (true) {
			case GenerateCommitsCommand.is(e):
				void this.onGenerateCommits(e.params);
				break;
			case GenerateCommitMessageCommand.is(e):
				void this.onGenerateCommitMessage(e.params);
				break;
			case FinishAndCommitCommand.is(e):
				void this.onFinishAndCommit(e.params);
				break;
			case CloseComposerCommand.is(e):
				void this.close();
				break;
			case OnSelectAIModelCommand.is(e):
				void this.onSelectAIModel();
				break;
			case AIFeedbackHelpfulCommand.is(e):
				void this.onAIFeedbackHelpful(e.params);
				break;
			case AIFeedbackUnhelpfulCommand.is(e):
				void this.onAIFeedbackUnhelpful(e.params);
				break;
		}
	}

	getTelemetryContext(): WebviewTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
		};
	}

	includeBootstrap(): State {
		// Use real data if provided, otherwise fall back to mock data
		const args = this._args;
		const hunks = args?.hunks ?? mockHunks;
		const commits = args?.commits ?? mockCommits;
		const hunkMap = args?.hunkMap ?? mockHunkMap;

		// Handle baseCommit - could be string (old format) or ComposerBaseCommit (new format)
		let baseCommit = args?.baseCommit ?? mockBaseCommit;
		if (typeof baseCommit === 'string') {
			// Convert old string format to new ComposerBaseCommit format
			baseCommit = {
				sha: baseCommit,
				message: 'HEAD',
				repoName: 'Repository',
				branchName: 'main',
			};
		}

		const state = {
			...this.host.baseWebviewState,
			hunks: hunks,
			commits: commits,
			hunkMap: hunkMap,
			baseCommit: baseCommit,

			// UI state
			selectedCommitId: null,
			selectedCommitIds: new Set<string>(),
			selectedUnassignedSection: null,
			selectedHunkIds: new Set<string>(),

			// Section expansion state
			detailsSectionExpanded: {
				commitMessage: true,
				aiExplanation: true,
				filesChanged: true,
			},
			generatingCommits: false,
			generatingCommitMessage: null,
			committing: false,

			// Mode controls
			mode: args?.mode ?? 'preview',

			// AI settings
			aiEnabled: this.getAiEnabled(),
			ai: {
				model: undefined, // Will be set asynchronously
			},
		};

		// Set AI model asynchronously
		void this.updateAiModel();

		return state;
	}

	onShowing(
		_loading: boolean,
		_options: any,
		...args: ComposerWebviewShowingArgs
	): [boolean, Record<`context.${string}`, string | number | boolean | undefined> | undefined] {
		// Store the args for use in includeBootstrap
		if (args?.[0]) {
			this._args = args[0];
			this.updateTitle(args[0].mode);
		}
		return [true, undefined];
	}

	private updateTitle(mode?: 'experimental' | 'preview'): void {
		const currentMode = mode ?? this._args?.mode ?? 'preview';
		if (currentMode === 'experimental') {
			this.host.title = 'GitLens Composer (Experimental)';
		} else {
			this.host.title = 'GitLens Composer (Preview)';
		}
	}

	private async close(): Promise<void> {
		await commands.executeCommand('workbench.action.closeActiveEditor');
	}

	private async updateAiModel(): Promise<void> {
		try {
			const model = await this.container.ai.getModel({ silent: true }, { source: 'ai' });
			await this.host.notify(DidChangeAiModelNotification, { model: model });
		} catch {
			// Ignore errors when getting AI model
		}
	}

	private async onSelectAIModel(): Promise<void> {
		// Trigger the AI provider/model switch command
		await commands.executeCommand('gitlens.ai.switchProvider', {
			source: 'ai',
			detail: 'model-picker',
		});
	}

	private async onAIFeedbackHelpful(params: AIFeedbackParams): Promise<void> {
		// Send AI feedback for composer auto-composition
		await this.sendComposerAIFeedback('helpful', params.sessionId);
	}

	private async onAIFeedbackUnhelpful(params: AIFeedbackParams): Promise<void> {
		// Send AI feedback for composer auto-composition
		await this.sendComposerAIFeedback('unhelpful', params.sessionId);
	}

	private async sendComposerAIFeedback(sentiment: 'helpful' | 'unhelpful', sessionId: string | null): Promise<void> {
		try {
			// Get the current AI model
			const model = await this.container.ai.getModel({ silent: true }, { source: 'ai' });
			if (!model) return;

			// Create a synthetic context for composer AI feedback
			const context = {
				id: sessionId || 'composer-session',
				type: 'generate-commits' as const,
				feature: 'composer',
				model: {
					id: model.id,
					name: model.name,
					maxTokens: model.maxTokens,
					provider: {
						id: model.provider.id,
						name: model.provider.name,
					},
					default: model.default,
					hidden: model.hidden,
					temperature: model.temperature,
				},
				usage: undefined,
			};

			let unhelpful;
			if (sentiment === 'unhelpful') {
				unhelpful = await showUnhelpfulFeedbackPicker();
				if (unhelpful === undefined) return; // User cancelled
			}

			// Use the shared feedback event sender
			sendFeedbackEvent(this.container, { source: 'ai' }, context, sentiment, unhelpful);
		} catch (error) {
			// Log error but don't throw to avoid breaking the UI
			console.error('Failed to send composer AI feedback:', error);
		}
	}

	private async onGenerateCommits(params: GenerateCommitsParams): Promise<void> {
		try {
			// Notify webview that generation is starting
			await this.host.notify(DidStartGeneratingNotification, undefined);

			// Transform the data for the AI service
			const hunks = params.hunks.map(hunk => ({
				index: hunk.index,
				fileName: hunk.fileName,
				diffHeader: hunk.diffHeader || `diff --git a/${hunk.fileName} b/${hunk.fileName}`,
				hunkHeader: hunk.hunkHeader,
				content: hunk.content,
				source: hunk.source,
			}));

			const existingCommits = params.commits.map(commit => ({
				id: commit.id,
				message: commit.message,
				aiExplanation: commit.aiExplanation,
				hunkIndices: commit.hunkIndices,
			}));

			// Call the AI service
			const result = await this.container.ai.generateCommits(
				hunks,
				existingCommits,
				params.hunkMap,
				{
					source: 'ai',
				},
				{
					progress: { location: ProgressLocation.Notification },
					customInstructions: params.customInstructions,
				},
			);

			if (result && result !== 'cancelled') {
				// Transform AI result back to ComposerCommit format
				const newCommits = result.commits.map((commit, index) => ({
					id: `ai-commit-${index}`,
					message: commit.message,
					aiExplanation: commit.explanation,
					hunkIndices: commit.hunks.map(h => h.hunk),
				}));

				// Notify the webview with the generated commits (this will also clear loading state)
				await this.host.notify(DidGenerateCommitsNotification, { commits: newCommits });
			} else {
				// Clear loading state even if cancelled/failed
				await this.host.notify(DidGenerateCommitsNotification, { commits: params.commits });
			}
		} catch {
			// Clear loading state on error
			await this.host.notify(DidGenerateCommitsNotification, { commits: params.commits });
		}
	}

	private async onGenerateCommitMessage(params: GenerateCommitMessageParams): Promise<void> {
		try {
			// Notify webview that commit message generation is starting
			await this.host.notify(DidStartGeneratingCommitMessageNotification, { commitId: params.commitId });

			// Call the AI service to generate commit message
			const result = await this.container.ai.generateCommitMessage(params.diff, {
				source: 'ai',
			});

			if (result && result !== 'cancelled') {
				// Combine summary and body into a single message
				const message = result.parsed.body
					? `${result.parsed.summary}\n\n${result.parsed.body}`
					: result.parsed.summary;

				// Notify the webview with the generated commit message
				await this.host.notify(DidGenerateCommitMessageNotification, {
					commitId: params.commitId,
					message: message,
				});
			} else {
				// Clear loading state even if cancelled/failed
				await this.host.notify(DidGenerateCommitMessageNotification, {
					commitId: params.commitId,
					message: '',
				});
			}
		} catch {
			// Clear loading state on error
			await this.host.notify(DidGenerateCommitMessageNotification, {
				commitId: params.commitId,
				message: '',
			});
		}
	}

	private async onFinishAndCommit(params: FinishAndCommitParams): Promise<void> {
		try {
			// Notify webview that committing is starting
			await this.host.notify(DidStartCommittingNotification, undefined);

			// Convert composer data to ComposerDiffInfo format
			const diffInfo = convertToComposerDiffInfo(params.commits, params.hunks);

			// Get the repository service
			const repo = this.container.git.getBestRepository();
			if (!repo) {
				throw new Error('No repository found');
			}
			const svc = this.container.git.getRepositoryService(repo.path);
			if (!svc) {
				throw new Error('No repository service found');
			}

			// Create unreachable commits from patches
			const shas = await repo.git.patch?.createUnreachableCommitsFromPatches(params.baseCommit.sha, diffInfo);

			if (!shas?.length) {
				throw new Error('Failed to create commits from patches');
			}

			// Capture the current HEAD before making changes
			const log = await svc.commits.getLog(undefined, { limit: 1 });
			let previousHeadRef;
			if (log?.commits.size) {
				const currentCommit = log.commits.values().next().value;
				if (currentCommit) {
					previousHeadRef = createReference(currentCommit.sha, svc.path, { refType: 'revision' });
				}
			}

			// Capture previous stash state
			let previousStashCommit;
			let stash = await svc.stash?.getStash();
			if (stash?.stashes.size) {
				const latestStash = stash.stashes.values().next().value;
				if (latestStash) {
					previousStashCommit = latestStash;
				}
			}

			// Stash the working changes
			await svc.stash?.saveStash(undefined, undefined, { includeUntracked: true });

			// Get the new stash reference
			let generatedStashRef;
			stash = await svc.stash?.getStash();
			if (stash?.stashes.size) {
				const stashCommit = stash.stashes.values().next().value;
				if (stashCommit && stashCommit.ref !== previousStashCommit?.ref) {
					generatedStashRef = createReference(stashCommit.ref, svc.path, {
						refType: 'stash',
						name: stashCommit.stashName,
						number: stashCommit.stashNumber,
						message: stashCommit.message,
						stashOnRef: stashCommit.stashOnRef,
					});
				}
			}

			// Reset the current branch to the new shas
			await svc.reset(shas[shas.length - 1], { hard: true });

			// Capture the new HEAD after reset
			const generatedHeadRef = createReference(shas[shas.length - 1], svc.path, { refType: 'revision' });

			// Clear the committing state and close the composer webview first
			await this.host.notify(DidFinishCommittingNotification, undefined);
			void commands.executeCommand('workbench.action.closeActiveEditor');

			// Show success notification with Undo button
			const undoButton = { title: 'Undo' };
			const resultNotification = await window.showInformationMessage(
				'Successfully generated commits from your working changes.',
				undoButton,
			);

			if (resultNotification === undoButton) {
				// Undo the commits
				void executeCommand('gitlens.ai.undoGenerateRebase', {
					undoCommand: 'gitlens.ai.generateCommits',
					repoPath: svc.path,
					generatedHeadRef: generatedHeadRef,
					previousHeadRef: previousHeadRef,
					generatedStashRef: generatedStashRef,
					source: 'composer',
				});
			}
		} catch (error) {
			// Clear loading state on error
			await this.host.notify(DidFinishCommittingNotification, undefined);

			// Show error message
			const { window } = await import('vscode');
			void window.showErrorMessage(
				`Failed to commit changes: ${error instanceof Error ? error.message : 'Unknown error'}`,
			);
		}
	}

	private onAnyConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'ai.enabled')) {
			// Update AI config setting in state
			void this.host.notify(DidChangeAiEnabledNotification, {
				config: configuration.get('ai.enabled', undefined, true),
			});
		}
	}

	private onContextChanged(key: keyof ContextKeys) {
		if (key === 'gitlens:gk:organization:ai:enabled') {
			// Update AI org setting in state
			void this.host.notify(DidChangeAiEnabledNotification, {
				org: getContext('gitlens:gk:organization:ai:enabled', true),
			});
		}
	}

	private onAIModelChanged(_e: AIModelChangeEvent) {
		void this.updateAiModel();
	}

	private getAiEnabled() {
		return {
			org: getContext('gitlens:gk:organization:ai:enabled', true),
			config: configuration.get('ai.enabled', undefined, true),
		};
	}
}
