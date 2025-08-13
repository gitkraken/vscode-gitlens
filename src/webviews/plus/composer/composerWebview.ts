import type { ConfigurationChangeEvent } from 'vscode';
import { CancellationTokenSource, commands, Disposable, ProgressLocation, window } from 'vscode';
import { md5 } from '@env/crypto';
import type { ContextKeys } from '../../../constants.context';
import type { ComposerTelemetryContext, Sources } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import type { Repository } from '../../../git/models/repository';
import { uncommitted, uncommittedStaged } from '../../../git/models/revision';
import { sendFeedbackEvent, showUnhelpfulFeedbackPicker } from '../../../plus/ai/aiFeedbackUtils';
import type { AIModelChangeEvent } from '../../../plus/ai/aiProviderService';
import { configuration } from '../../../system/-webview/configuration';
import { getContext, onDidChangeContext } from '../../../system/-webview/context';
import { PromiseCache } from '../../../system/promiseCache';
import type { IpcMessage } from '../../protocol';
import type { WebviewHost, WebviewProvider } from '../../webviewProvider';
import type {
	AddedHunksToCommitParams,
	AIFeedbackParams,
	ComposerContext,
	FinishAndCommitParams,
	GenerateCommitMessageParams,
	GenerateCommitsParams,
	ReloadComposerParams,
	State,
} from './protocol';
import {
	AddedHunksToCommitCommand,
	AIFeedbackHelpfulCommand,
	AIFeedbackUnhelpfulCommand,
	baseContext,
	CancelGenerateCommitMessageCommand,
	CancelGenerateCommitsCommand,
	ClearAIOperationErrorCommand,
	CloseComposerCommand,
	currentOnboardingVersion,
	DidCancelGenerateCommitMessageNotification,
	DidCancelGenerateCommitsNotification,
	DidChangeAiEnabledNotification,
	DidChangeAiModelNotification,
	DidClearAIOperationErrorNotification,
	DidErrorAIOperationNotification,
	DidFinishCommittingNotification,
	DidGenerateCommitMessageNotification,
	DidGenerateCommitsNotification,
	DidLoadingErrorNotification,
	DidReloadComposerNotification,
	DidSafetyErrorNotification,
	DidStartCommittingNotification,
	DidStartGeneratingCommitMessageNotification,
	DidStartGeneratingNotification,
	DismissOnboardingCommand,
	FinishAndCommitCommand,
	GenerateCommitMessageCommand,
	GenerateCommitsCommand,
	initialState,
	OnSelectAIModelCommand,
	ReloadComposerCommand,
} from './protocol';
import type { ComposerWebviewShowingArgs } from './registration';
import {
	convertToComposerDiffInfo,
	createHunksFromDiffs,
	createSafetyState,
	validateCombinedDiff,
	validateSafetyState,
} from './utils';

export class ComposerWebviewProvider implements WebviewProvider<State, State, ComposerWebviewShowingArgs> {
	private readonly _disposable: Disposable;
	private _args?: ComposerWebviewShowingArgs[0];
	private _cache = new PromiseCache<'bootstrap', State>({ accessTTL: 1000 * 60 * 5 });

	// Cancellation tokens for ongoing operations
	private _generateCommitsCancellation?: CancellationTokenSource;
	private _generateCommitMessageCancellation?: CancellationTokenSource;

	// Telemetry context - tracks composer-specific data for getTelemetryContext
	private _context: ComposerContext;

	constructor(
		protected readonly container: Container,
		protected readonly host: WebviewHost<'gitlens.composer'>,
	) {
		this._disposable = Disposable.from(
			configuration.onDidChangeAny(this.onAnyConfigurationChanged, this),
			onDidChangeContext(this.onContextChanged, this),
			this.container.ai.onDidChangeModel(this.onAIModelChanged, this),
		);
		this._context = { ...baseContext };
	}

	dispose(): void {
		this._cache.clear();
		this.resetTelemetryContext();
		this._generateCommitsCancellation?.dispose();
		this._generateCommitMessageCancellation?.dispose();
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
			case ReloadComposerCommand.is(e):
				void this.onReloadComposer(e.params);
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
			case CancelGenerateCommitsCommand.is(e):
				void this.onCancelGenerateCommits();
				break;
			case CancelGenerateCommitMessageCommand.is(e):
				void this.onCancelGenerateCommitMessage();
				break;
			case ClearAIOperationErrorCommand.is(e):
				void this.onClearAIOperationError();
				break;
			case DismissOnboardingCommand.is(e):
				this.onDismissOnboarding();
				break;
			case AddedHunksToCommitCommand.is(e):
				this.onAddedHunksToCommit(e.params);
				break;
		}
	}

	getTelemetryContext(): ComposerTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
			'context.sessionId': this._context.sessionId,
			'context.files.count': this._context.diff.files,
			'context.hunks.count': this._context.diff.hunks,
			'context.lines.count': this._context.diff.lines,
			'context.draftCommits.initialCount': this._context.draftCommits.initialCount,
			'context.draftCommits.finalCount': this._context.draftCommits.finalCount,
			'context.diffSources.staged': this._context.diff.staged,
			'context.diffSources.unstaged': this._context.diff.unstaged,
			'context.diffSources.unstaged.included': this._context.diff.unstagedIncluded,
			'context.model.id': this._context.ai.model?.id,
			'context.model.name': this._context.ai.model?.name,
			'context.model.provider.id': this._context.ai.model?.provider.id,
			'context.model.temperature': this._context.ai.model?.temperature ?? undefined,
			'context.model.maxTokens.input': this._context.ai.model?.maxTokens.input,
			'context.model.maxTokens.output': this._context.ai.model?.maxTokens.output,
			'context.model.default': this._context.ai.model?.default,
			'context.model.hidden': this._context.ai.model?.hidden,
			'context.ai.operations.generateCommits.count': this._context.ai.operations.generateCommits.count,
			'context.ai.operations.generateCommits.cancelled.count':
				this._context.ai.operations.generateCommits.cancelledCount,
			'context.ai.operations.generateCommits.error.count': this._context.ai.operations.generateCommits.errorCount,
			'context.ai.operations.generateCommits.customInstructions.used':
				this._context.ai.operations.generateCommits.customInstructions.used,
			'context.ai.operations.generateCommits.customInstructions.length':
				this._context.ai.operations.generateCommits.customInstructions.length,
			'context.ai.operations.generateCommits.customInstructions.hash':
				this._context.ai.operations.generateCommits.customInstructions.hash,
			'context.ai.operations.generateCommits.customInstructions.setting.used':
				this._context.ai.operations.generateCommits.customInstructions.settingUsed,
			'context.ai.operations.generateCommits.customInstructions.setting.length':
				this._context.ai.operations.generateCommits.customInstructions.settingLength,
			'context.ai.operations.generateCommits.feedback.upvote.count':
				this._context.ai.operations.generateCommits.feedback.upvoteCount,
			'context.ai.operations.generateCommits.feedback.downvote.count':
				this._context.ai.operations.generateCommits.feedback.downvoteCount,
			'context.ai.operations.generateCommitMessage.count':
				this._context.ai.operations.generateCommitMessage.count,
			'context.ai.operations.generateCommitMessage.cancelled.count':
				this._context.ai.operations.generateCommitMessage.cancelledCount,
			'context.ai.operations.generateCommitMessage.error.count':
				this._context.ai.operations.generateCommitMessage.errorCount,
			'context.ai.operations.generateCommitMessage.customInstructions.setting.used':
				this._context.ai.operations.generateCommitMessage.customInstructions.settingUsed,
			'context.ai.operations.generateCommitMessage.customInstructions.setting.length':
				this._context.ai.operations.generateCommitMessage.customInstructions.settingLength,
			'context.ai.enabled.config': this._context.ai.enabled.config,
			'context.ai.enabled.org': this._context.ai.enabled.org,
			'context.onboarding.dismissed': this._context.onboarding.dismissed,
		};
	}

	includeBootstrap(): Promise<State> {
		return this._cache.get('bootstrap', () => this.getBootstrapState());
	}

	private async getBootstrapState(): Promise<State> {
		// Use real data if provided, otherwise initialize from best repository
		const args = this._args;

		// Get the repository from args or show picker
		let repo;
		if (args?.repoPath != null) {
			repo = this.container.git.getRepository(args.repoPath);
		} else {
			repo = this.container.git.getBestRepository();
		}

		if (repo == null) {
			// return a base state with an error
			return {
				...this.initialState,
				loadingError: 'No repository found. Please open a Git repository to use the Commit Composer.',
			};
		}

		return this.createInitialStateFromRepo(repo, args?.mode, args?.source);
	}

	private get initialState(): State {
		return {
			...this.host.baseWebviewState,
			...initialState,
		};
	}

	private async createInitialStateFromRepo(
		repo: Repository,
		mode: 'experimental' | 'preview' = 'preview',
		source?: Sources,
	): Promise<State> {
		// Handle baseCommit - could be string (old format) or ComposerBaseCommit (new format)
		const stagedDiff = await repo.git.diff.getDiff?.(uncommittedStaged);

		const unstagedDiff = await repo.git.diff.getDiff?.(uncommitted);

		// Allow composer to open with no changes - we'll handle this in the UI
		const hasChanges = Boolean(stagedDiff?.contents || unstagedDiff?.contents);

		const { hunkMap, hunks } = createHunksFromDiffs(stagedDiff?.contents, unstagedDiff?.contents);

		const baseCommit = await repo.git.commits.getCommit('HEAD');
		if (baseCommit == null) {
			return {
				...this.initialState,
				loadingError: 'No base commit found to compose from.',
			};
		}

		const currentBranch = await repo.git.branches.getBranch();
		if (currentBranch == null) {
			return {
				...this.initialState,
				loadingError: 'No current branch found to compose from.',
			};
		}

		// Create initial commit with empty message (user will add message later)
		const hasStagedChanges = Boolean(stagedDiff?.contents);
		const hasUnstagedChanges = Boolean(unstagedDiff?.contents);

		let initialHunkIndices: number[];

		if (hasStagedChanges && hasUnstagedChanges) {
			// Both staged and unstaged - assign only staged to initial commit
			initialHunkIndices = hunks.filter(h => h.source === 'staged').map(h => h.index);
		} else {
			// Only staged or only unstaged - assign all to initial commit
			initialHunkIndices = hunks.map(h => h.index);
		}

		const initialCommit = {
			id: 'draft-commit-1',
			message: '', // Empty message - user will add their own
			aiExplanation: '',
			hunkIndices: initialHunkIndices,
		};

		// Create safety state snapshot for validation
		const safetyState = await createSafetyState(repo);

		const aiEnabled = this.getAiEnabled();
		const aiModel = await this.container.ai.getModel({ silent: true }, { source: 'composer' });

		const onboardingDismissed = this.isOnboardingDismissed();
		const commits = hasChanges ? [initialCommit] : [];

		const generateCommitsInstructionSetting = configuration.get('ai.generateCommits.customInstructions');
		const generateCommitMessageInstructionSetting = configuration.get(
			'ai.generateCommitMessage.customInstructions',
		);

		// Update context
		this._context.ai.operations.generateCommits.customInstructions.settingUsed = Boolean(
			generateCommitsInstructionSetting,
		);
		this._context.ai.operations.generateCommits.customInstructions.settingLength =
			generateCommitsInstructionSetting?.length ?? 0;
		this._context.ai.operations.generateCommitMessage.customInstructions.settingUsed = Boolean(
			generateCommitMessageInstructionSetting,
		);
		this._context.ai.operations.generateCommitMessage.customInstructions.settingLength =
			generateCommitMessageInstructionSetting?.length ?? 0;
		this._context.diff.files = new Set(hunks.map(h => h.fileName)).size;
		this._context.diff.hunks = hunks.length;
		this._context.diff.lines = hunks.reduce((total, hunk) => total + hunk.content.split('\n').length - 1, 0);
		this._context.diff.staged = hasStagedChanges;
		this._context.diff.unstaged = hasUnstagedChanges;
		this._context.draftCommits.initialCount = commits.length;
		this._context.ai.enabled.org = aiEnabled.org;
		this._context.ai.enabled.config = aiEnabled.config;
		this._context.ai.model = aiModel;
		this._context.onboarding.dismissed = onboardingDismissed;
		this._context.source = source;
		this._context.mode = mode;
		this._context.sessionId = `composer-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;

		return {
			...this.initialState,
			hunks: hunks,
			hunkMap: hunkMap,
			baseCommit: {
				sha: baseCommit.sha,
				message: baseCommit.message ?? '',
				repoName: repo.name,
				branchName: currentBranch.name,
			},
			commits: commits,
			safetyState: safetyState,
			aiEnabled: aiEnabled,
			ai: {
				model: aiModel,
			},
			hasChanges: hasChanges,
			mode: mode,
			onboardingDismissed: onboardingDismissed,
		};
	}

	private onAddedHunksToCommit(params: AddedHunksToCommitParams): void {
		if (params.source === 'unstaged') {
			this._context.diff.unstagedIncluded = true;
		}
	}

	private async onReloadComposer(params: ReloadComposerParams): Promise<void> {
		try {
			// Clear cache to force fresh data on reload
			this._cache.clear();

			// Get the best repository
			const repo = this.container.git.getRepository(params.repoPath);
			if (!repo) {
				// Show error in the safety error overlay
				this._context.errors.safety++;
				await this.host.notify(DidSafetyErrorNotification, {
					error: 'Repository is no longer available',
				});
				return;
			}

			// Initialize composer data from the repository
			const composerData = await this.createInitialStateFromRepo(repo, params.mode, params.source);

			// Check if there was a loading error
			if (composerData.loadingError) {
				// Send loading error notification instead of reload notification
				this._context.errors.loading++;
				await this.host.notify(DidLoadingErrorNotification, {
					error: composerData.loadingError,
				});
				return;
			}

			// Notify the state provider with fresh data to completely reload the state
			await this.host.notify(DidReloadComposerNotification, {
				hunks: composerData.hunks,
				commits: composerData.commits,
				hunkMap: composerData.hunkMap,
				baseCommit: composerData.baseCommit,
				safetyState: composerData.safetyState,
				loadingError: composerData.loadingError,
				hasChanges: composerData.hasChanges,
			});
		} catch (error) {
			// Show error in the safety error overlay
			this._context.errors.loading++;
			await this.host.notify(DidLoadingErrorNotification, {
				error: error instanceof Error ? error.message : 'Failed to reload composer',
			});
		}
	}

	private async onCancelGenerateCommits(): Promise<void> {
		if (this._generateCommitsCancellation) {
			this._generateCommitsCancellation.cancel();

			// Send cancellation notification to clear loading state properly
			this._context.ai.operations.generateCommits.cancelledCount++;
			await this.host.notify(DidCancelGenerateCommitsNotification, undefined);

			// Note: Don't dispose the token immediately - let the finally block handle cleanup
			// This ensures the async operation can still detect the cancellation
		}
	}

	private async onCancelGenerateCommitMessage(): Promise<void> {
		if (this._generateCommitMessageCancellation) {
			this._generateCommitMessageCancellation.cancel();

			// Send cancellation notification to clear loading state properly
			this._context.ai.operations.generateCommitMessage.cancelledCount++;
			await this.host.notify(DidCancelGenerateCommitMessageNotification, undefined);

			// Note: Don't dispose the token immediately - let the finally block handle cleanup
			// This ensures the async operation can still detect the cancellation
		}
	}

	private async onClearAIOperationError(): Promise<void> {
		// Send notification to clear the AI operation error
		await this.host.notify(DidClearAIOperationErrorNotification, undefined);
	}

	private onDismissOnboarding(): void {
		if (this.isOnboardingDismissed()) {
			return;
		}

		this._context.onboarding.dismissed = true;
		void this.container.storage.store('composer:onboarding:dismissed', currentOnboardingVersion).catch();
	}

	private isOnboardingDismissed(): boolean {
		const dismissedVersion = this.container.storage.get('composer:onboarding:dismissed');
		return dismissedVersion === currentOnboardingVersion;
	}

	private resetTelemetryContext(): void {
		this._context = { ...baseContext };
	}

	onShowing(
		_loading: boolean,
		_options: any,
		...args: ComposerWebviewShowingArgs
	): [boolean, Record<`context.${string}`, string | number | boolean | undefined> | undefined] {
		// Store the args for use in includeBootstrap
		if (args?.[0]) {
			// Clear cache when new args are provided (new composer session)
			this._cache.clear();
			this.resetTelemetryContext();
			this._args = args[0];
			this.updateTitle(args[0].mode);
		}
		return [true, undefined];
	}

	private updateTitle(mode?: 'experimental' | 'preview'): void {
		const currentMode = mode ?? this._args?.mode ?? 'preview';
		if (currentMode === 'experimental') {
			this.host.title = 'Commit Composer (Experimental)';
		} else {
			this.host.title = 'Commit Composer (Preview)';
		}
	}

	private async close(): Promise<void> {
		await commands.executeCommand('workbench.action.closeActiveEditor');
	}

	private async updateAiModel(): Promise<void> {
		try {
			const model = await this.container.ai.getModel({ silent: true }, { source: 'composer' });
			this._context.ai.model = model;
			await this.host.notify(DidChangeAiModelNotification, { model: model });
		} catch {
			// Ignore errors when getting AI model
		}
	}

	private async onSelectAIModel(): Promise<void> {
		// Trigger the AI provider/model switch command
		await commands.executeCommand('gitlens.ai.switchProvider', {
			source: 'composer',
			detail: 'model-picker',
		});
	}

	private async onAIFeedbackHelpful(params: AIFeedbackParams): Promise<void> {
		// Send AI feedback for composer auto-composition
		this._context.ai.operations.generateCommits.feedback.upvoteCount++;
		await this.sendComposerAIFeedback('helpful', params.sessionId);
	}

	private async onAIFeedbackUnhelpful(params: AIFeedbackParams): Promise<void> {
		// Send AI feedback for composer auto-composition
		this._context.ai.operations.generateCommits.feedback.downvoteCount++;
		await this.sendComposerAIFeedback('unhelpful', params.sessionId);
	}

	private async sendComposerAIFeedback(sentiment: 'helpful' | 'unhelpful', sessionId: string | null): Promise<void> {
		try {
			// Get the current AI model
			const model = await this.container.ai.getModel({ silent: true }, { source: 'composer' });
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
			sendFeedbackEvent(this.container, { source: 'composer' }, context, sentiment, unhelpful);
		} catch (error) {
			// Log error but don't throw to avoid breaking the UI
			console.error('Failed to send composer AI feedback:', error);
		}
	}

	private async onGenerateCommits(params: GenerateCommitsParams): Promise<void> {
		try {
			this._context.ai.operations.generateCommits.count++;
			if (params.customInstructions) {
				this._context.ai.operations.generateCommits.customInstructions.used = true;
				this._context.ai.operations.generateCommits.customInstructions.length =
					params.customInstructions.length;
				this._context.ai.operations.generateCommits.customInstructions.hash = md5(params.customInstructions);
			}

			// Create cancellation token for this operation
			this._generateCommitsCancellation = new CancellationTokenSource();

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
				{ source: 'composer' },
				{
					cancellation: this._generateCommitsCancellation.token,
					progress: { location: ProgressLocation.Notification },
					customInstructions: params.customInstructions,
				},
			);

			if (this._generateCommitsCancellation?.token.isCancellationRequested) {
				this._context.ai.operations.generateCommits.cancelledCount++;
				await this.host.notify(DidCancelGenerateCommitsNotification, undefined);
				return;
			}

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
			} else if (result === 'cancelled') {
				this._context.ai.operations.generateCommits.cancelledCount++;
				// Send cancellation notification instead of success notification
				await this.host.notify(DidCancelGenerateCommitsNotification, undefined);
			} else {
				this._context.ai.operations.generateCommits.errorCount++;
				this._context.errors.aiOperation++;
				// Send error notification for failure (not cancellation)
				await this.host.notify(DidErrorAIOperationNotification, {
					operation: 'generate commits',
					error: undefined,
				});
			}
		} catch (error) {
			// Check if this was a cancellation or a real error
			if (this._generateCommitsCancellation?.token.isCancellationRequested) {
				this._context.ai.operations.generateCommits.cancelledCount++;
				// Send cancellation notification
				await this.host.notify(DidCancelGenerateCommitsNotification, undefined);
			} else {
				this._context.ai.operations.generateCommits.errorCount++;
				this._context.errors.aiOperation++;
				// Send error notification for exception
				await this.host.notify(DidErrorAIOperationNotification, {
					operation: 'generate commits',
					error: error instanceof Error ? error.message : undefined,
				});
			}
		} finally {
			// Clean up cancellation token
			this._generateCommitsCancellation?.dispose();
			this._generateCommitsCancellation = undefined;
		}
	}

	private async onGenerateCommitMessage(params: GenerateCommitMessageParams): Promise<void> {
		try {
			this._context.ai.operations.generateCommitMessage.count++;

			// Create cancellation token for this operation
			this._generateCommitMessageCancellation = new CancellationTokenSource();

			// Notify webview that commit message generation is starting
			await this.host.notify(DidStartGeneratingCommitMessageNotification, { commitId: params.commitId });

			// Call the AI service to generate commit message
			const result = await this.container.ai.generateCommitMessage(
				params.diff,
				{ source: 'composer' },
				{
					cancellation: this._generateCommitMessageCancellation.token,
				},
			);

			if (this._generateCommitMessageCancellation?.token.isCancellationRequested) {
				this._context.ai.operations.generateCommitMessage.cancelledCount++;
				await this.host.notify(DidCancelGenerateCommitMessageNotification, undefined);
				return;
			}

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
			} else if (result === 'cancelled') {
				this._context.ai.operations.generateCommitMessage.cancelledCount++;
				// Send cancellation notification instead of success notification
				await this.host.notify(DidCancelGenerateCommitMessageNotification, undefined);
			} else {
				this._context.ai.operations.generateCommitMessage.errorCount++;
				this._context.errors.aiOperation++;
				// Send error notification for failure (not cancellation)
				await this.host.notify(DidErrorAIOperationNotification, {
					operation: 'generate commit message',
					error: undefined,
				});
			}
		} catch (error) {
			// Check if this was a cancellation or a real error
			if (this._generateCommitMessageCancellation?.token.isCancellationRequested) {
				this._context.ai.operations.generateCommitMessage.cancelledCount++;
				// Send cancellation notification
				await this.host.notify(DidCancelGenerateCommitMessageNotification, undefined);
			} else {
				this._context.ai.operations.generateCommitMessage.errorCount++;
				this._context.errors.aiOperation++;
				// Send error notification for exception
				await this.host.notify(DidErrorAIOperationNotification, {
					operation: 'generate commit message',
					error: error instanceof Error ? error.message : undefined,
				});
			}
		} finally {
			// Clean up cancellation token
			this._generateCommitMessageCancellation?.dispose();
			this._generateCommitMessageCancellation = undefined;
		}
	}

	private async onFinishAndCommit(params: FinishAndCommitParams): Promise<void> {
		try {
			// Notify webview that committing is starting
			await this.host.notify(DidStartCommittingNotification, undefined);

			// Get the specific repository from the safety state
			const repo = this.container.git.getRepository(params.safetyState.repoPath);
			if (!repo) {
				// Clear loading state and show safety error
				await this.host.notify(DidFinishCommittingNotification, undefined);
				this._context.errors.safety++;
				await this.host.notify(DidSafetyErrorNotification, {
					error: 'Repository is no longer available',
				});
				return;
			}

			// Extract hunk sources for smart validation
			const hunksBeingCommitted = params.hunks.filter(hunk =>
				params.commits.some(c => c.hunkIndices.includes(hunk.index)),
			);

			// Validate repository safety state before proceeding
			const validation = await validateSafetyState(repo, params.safetyState, hunksBeingCommitted);
			if (!validation.isValid) {
				// Clear loading state and show safety error
				await this.host.notify(DidFinishCommittingNotification, undefined);
				this._context.errors.safety++;
				await this.host.notify(DidSafetyErrorNotification, {
					error: validation.errors.join('\n'),
				});
				return;
			}

			// Convert composer data to ComposerDiffInfo format
			const diffInfo = convertToComposerDiffInfo(params.commits, params.hunks);
			const svc = this.container.git.getRepositoryService(repo.path);
			if (!svc) {
				throw new Error('No repository service found');
			}

			// Create unreachable commits from patches
			const shas = await repo.git.patch?.createUnreachableCommitsFromPatches(params.baseCommit.sha, diffInfo);

			if (!shas?.length) {
				throw new Error('Failed to create commits from patches');
			}

			const combinedDiff = (
				await repo.git.diff.getDiff?.(shas[shas.length - 1], params.baseCommit.sha, {
					notation: '...',
				})
			)?.contents;

			if (!combinedDiff) {
				throw new Error('Failed to get combined diff');
			}

			if (
				!validateCombinedDiff(
					params.safetyState,
					combinedDiff,
					hunksBeingCommitted.some(h => h.source === 'unstaged'),
				)
			) {
				// Clear loading state and show safety error
				await this.host.notify(DidFinishCommittingNotification, undefined);
				this._context.errors.safety++;
				await this.host.notify(DidSafetyErrorNotification, {
					error: 'Output diff does not match input',
				});
				return;
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
			const stashMessage = `Commit composer: ${new Date().toLocaleString()}`;
			await svc.stash?.saveStash(stashMessage, undefined, { includeUntracked: true });

			// Get the new stash reference
			stash = await svc.stash?.getStash();
			let stashCommit;
			let stashedSuccessfully = false;
			if (stash?.stashes.size) {
				stashCommit = stash.stashes.values().next().value;
				if (
					stashCommit &&
					stashCommit.ref !== previousStashCommit?.ref &&
					stashCommit.message === stashMessage
				) {
					stashedSuccessfully = true;
				}
			}

			// Reset the current branch to the new shas
			await svc.reset(shas[shas.length - 1], { hard: true });

			// Pop the stash we created to restore what is left in the working tree
			if (stashCommit && stashedSuccessfully) {
				await svc.stash?.applyStash(stashCommit.stashName, { deleteAfter: true });
			}

			// Clear the committing state and close the composer webview first
			this._context.draftCommits.finalCount = shas.length;
			await this.host.notify(DidFinishCommittingNotification, undefined);
			void commands.executeCommand('workbench.action.closeActiveEditor');
		} catch (error) {
			// Clear loading state on error
			await this.host.notify(DidFinishCommittingNotification, undefined);
			void window.showErrorMessage(
				`Failed to commit changes: ${error instanceof Error ? error.message : 'Unknown error'}`,
			);
		}
	}

	private onAnyConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'ai.enabled')) {
			const newSetting = configuration.get('ai.enabled', undefined, true);
			this._context.ai.enabled.config = newSetting;
			// Update AI config setting in state
			void this.host.notify(DidChangeAiEnabledNotification, {
				config: newSetting,
			});
		}

		if (configuration.changed(e, 'ai.generateCommits.customInstructions')) {
			const newSetting = configuration.get('ai.generateCommits.customInstructions');
			this._context.ai.operations.generateCommits.customInstructions.settingUsed = Boolean(newSetting);
			this._context.ai.operations.generateCommits.customInstructions.settingLength = newSetting?.length ?? 0;
		}

		if (configuration.changed(e, 'ai.generateCommitMessage.customInstructions')) {
			const newSetting = configuration.get('ai.generateCommitMessage.customInstructions');
			this._context.ai.operations.generateCommitMessage.customInstructions.settingUsed = Boolean(newSetting);
			this._context.ai.operations.generateCommitMessage.customInstructions.settingLength =
				newSetting?.length ?? 0;
		}
	}

	private onContextChanged(key: keyof ContextKeys) {
		if (key === 'gitlens:gk:organization:ai:enabled') {
			const newSetting = getContext('gitlens:gk:organization:ai:enabled', true);
			this._context.ai.enabled.org = newSetting;
			// Update AI org setting in state
			void this.host.notify(DidChangeAiEnabledNotification, {
				org: newSetting,
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
