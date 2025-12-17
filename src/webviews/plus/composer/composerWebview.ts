import type { ConfigurationChangeEvent } from 'vscode';
import { CancellationTokenSource, commands, Disposable, window } from 'vscode';
import { md5, sha256 } from '@env/crypto';
import type { ContextKeys } from '../../../constants.context';
import type { ComposerTelemetryContext, Source, Sources } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import type {
	Repository,
	RepositoryChangeEvent,
	RepositoryFileSystemChangeEvent,
} from '../../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../../git/models/repository';
import { rootSha } from '../../../git/models/revision';
import { getBranchMergeTargetName } from '../../../git/utils/-webview/branch.utils';
import { sendFeedbackEvent, showUnhelpfulFeedbackPicker } from '../../../plus/ai/aiFeedbackUtils';
import type { AIModelChangeEvent } from '../../../plus/ai/aiProviderService';
import { getRepositoryPickerTitleAndPlaceholder, showRepositoryPicker } from '../../../quickpicks/repositoryPicker';
import { executeCoreCommand } from '../../../system/-webview/command';
import { configuration } from '../../../system/-webview/configuration';
import { getContext, onDidChangeContext } from '../../../system/-webview/context';
import { getSettledValue } from '../../../system/promise';
import { PromiseCache } from '../../../system/promiseCache';
import type { IpcMessage } from '../../protocol';
import type { WebviewHost, WebviewProvider } from '../../webviewProvider';
import type {
	AIFeedbackParams,
	ComposerActionEventFailureData,
	ComposerBaseCommit,
	ComposerCommit,
	ComposerContext,
	ComposerGenerateCommitMessageEventData,
	ComposerGenerateCommitsEventData,
	ComposerHunk,
	ComposerLoadedErrorData,
	ComposerSafetyState,
	ComposerTelemetryEvent,
	FinishAndCommitParams,
	GenerateCommitMessageParams,
	GenerateCommitsParams,
	OnAddHunksToCommitParams,
	ReloadComposerParams,
	State,
} from './protocol';
import {
	AdvanceOnboardingCommand,
	AIFeedbackHelpfulCommand,
	AIFeedbackUnhelpfulCommand,
	baseContext,
	CancelGenerateCommitMessageCommand,
	CancelGenerateCommitsCommand,
	ChooseRepositoryCommand,
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
	DidIndexChangeNotification,
	DidLoadingErrorNotification,
	DidReloadComposerNotification,
	DidSafetyErrorNotification,
	DidStartCommittingNotification,
	DidStartGeneratingCommitMessageNotification,
	DidStartGeneratingNotification,
	DidWorkingDirectoryChangeNotification,
	DismissOnboardingCommand,
	FinishAndCommitCommand,
	GenerateCommitMessageCommand,
	GenerateCommitsCommand,
	initialState,
	OnAddHunksToCommitCommand,
	OnRedoCommand,
	OnResetCommand,
	OnSelectAIModelCommand,
	OnUndoCommand,
	OpenOnboardingCommand,
	ReloadComposerCommand,
} from './protocol';
import type { ComposerWebviewShowingArgs } from './registration';
import type { ComposerDiffs } from './utils/composer.utils';
import {
	calculateCombinedDiffBetweenCommits,
	convertToComposerDiffInfo,
	createCombinedDiffForCommit,
	createComposerCommitsFromGitCommits,
	createHunksFromDiffs,
	createSafetyState,
	getAuthorAndCoAuthorsForCombinedDiffHunk,
	getBranchCommits,
	getComposerDiffs,
	validateResultingDiff,
	validateSafetyState,
} from './utils/composer.utils';

export class ComposerWebviewProvider implements WebviewProvider<State, State, ComposerWebviewShowingArgs> {
	private readonly _disposable: Disposable;
	private _args?: ComposerWebviewShowingArgs[0];
	private _cache = new PromiseCache<'bootstrap', State>({ accessTTL: 1000 * 60 * 5 });

	// Cancellation tokens for ongoing operations
	private _generateCommitsCancellation?: CancellationTokenSource;
	private _generateCommitMessageCancellation?: CancellationTokenSource;

	// Repository subscription for working directory changes
	private _repositorySubscription?: Disposable;
	private _currentRepository?: Repository;

	// Hunk map and safety state
	private _hunks: ComposerHunk[] = [];
	private _safetyState: ComposerSafetyState;

	// Branch mode state
	private _recompose: {
		enabled: boolean;
		branchName?: string;
		locked: boolean;
		commitShas?: string[];
		range?: { base: string; head: string };
	} | null = null;

	// Telemetry context - tracks composer-specific data for getTelemetryContext
	private _context: ComposerContext;

	// Flag to ignore index change tracking for when we need to stage untracked files
	private _ignoreIndexChange = false;

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
		this._safetyState = {
			repoPath: '',
			headSha: null,
			baseSha: null,
			hashes: {
				staged: null,
				unstaged: null,
				unified: null,
			},
		};
	}

	dispose(): void {
		this._cache.clear();
		this.resetContext();
		this._generateCommitsCancellation?.dispose();
		this._generateCommitMessageCancellation?.dispose();
		this._repositorySubscription?.dispose();
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
			case OpenOnboardingCommand.is(e):
				this.onOpenOnboarding();
				break;
			case AdvanceOnboardingCommand.is(e):
				this.onAdvanceOnboarding(e.params);
				break;
			case DismissOnboardingCommand.is(e):
				this.onDismissOnboarding();
				break;
			case OnAddHunksToCommitCommand.is(e):
				void this.onAddHunksToCommit(e.params);
				break;
			case OnUndoCommand.is(e):
				this.onUndo();
				break;
			case OnRedoCommand.is(e):
				this.onRedo();
				break;
			case OnResetCommand.is(e):
				this.onReset();
				break;
			case ChooseRepositoryCommand.is(e):
				void this.onChooseRepository();
				break;
		}
	}

	getTelemetryContext(): ComposerTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
			'context.session.start': this._context.sessionStart,
			'context.session.duration': this._context.sessionDuration,
			'context.source': this._context.source,
			'context.mode': this._context.mode,
			'context.diff.files.count': this._context.diff.files,
			'context.diff.hunks.count': this._context.diff.hunks,
			'context.diff.lines.count': this._context.diff.lines,
			'context.diff.staged.exists': this._context.diff.staged,
			'context.diff.unstaged.exists': this._context.diff.unstaged,
			'context.diff.unstaged.included': this._context.diff.unstagedIncluded,
			'context.commits.initialCount': this._context.commits.initialCount,
			'context.commits.autoComposedCount': this._context.commits.autoComposedCount,
			'context.commits.composedCount': this._context.commits.composedCount,
			'context.commits.finalCount': this._context.commits.finalCount,
			'context.ai.enabled.config': this._context.ai.enabled.config,
			'context.ai.enabled.org': this._context.ai.enabled.org,
			'context.ai.model.id': this._context.ai.model?.id,
			'context.ai.model.name': this._context.ai.model?.name,
			'context.ai.model.provider.id': this._context.ai.model?.provider.id,
			'context.ai.model.temperature': this._context.ai.model?.temperature ?? undefined,
			'context.ai.model.maxTokens.input': this._context.ai.model?.maxTokens.input,
			'context.ai.model.maxTokens.output': this._context.ai.model?.maxTokens.output,
			'context.ai.model.default': this._context.ai.model?.default,
			'context.ai.model.hidden': this._context.ai.model?.hidden,
			'context.onboarding.stepReached': this._context.onboarding.stepReached,
			'context.onboarding.dismissed': this._context.onboarding.dismissed,
			'context.operations.generateCommits.count': this._context.operations.generateCommits.count,
			'context.operations.generateCommits.cancelled.count':
				this._context.operations.generateCommits.cancelledCount,
			'context.operations.generateCommits.error.count': this._context.operations.generateCommits.errorCount,
			'context.operations.generateCommits.feedback.upvote.count':
				this._context.operations.generateCommits.feedback.upvoteCount,
			'context.operations.generateCommits.feedback.downvote.count':
				this._context.operations.generateCommits.feedback.downvoteCount,
			'context.operations.generateCommitMessage.count': this._context.operations.generateCommitMessage.count,
			'context.operations.generateCommitMessage.cancelled.count':
				this._context.operations.generateCommitMessage.cancelledCount,
			'context.operations.generateCommitMessage.error.count':
				this._context.operations.generateCommitMessage.errorCount,
			'context.operations.finishAndCommit.error.count': this._context.operations.finishAndCommit.errorCount,
			'context.operations.undo.count': this._context.operations.undo.count,
			'context.operations.redo.count': this._context.operations.redo.count,
			'context.operations.reset.count': this._context.operations.reset.count,
			'context.warnings.workingDirectoryChanged': this._context.warnings.workingDirectoryChanged,
			'context.warnings.indexChanged': this._context.warnings.indexChanged,
			'context.errors.safety.count': this._context.errors.safety.count,
			'context.errors.operation.count': this._context.errors.operation.count,
		};
	}

	includeBootstrap(_deferrable?: boolean): Promise<State> {
		return this._cache.getOrCreate('bootstrap', () => this.getBootstrapState());
	}

	private async getBootstrapState(): Promise<State> {
		// Wait for repository discovery to complete if it's in progress
		if (this.container.git.isDiscoveringRepositories) {
			await this.container.git.isDiscoveringRepositories;
		}

		// Use real data if provided, otherwise initialize from best repository
		const args = this._args;

		// Get the repository from args or show picker
		let repo;
		if (args?.repoPath != null) {
			repo = this.container.git.getRepository(args.repoPath);
		} else {
			repo = this.container.git.getBestRepositoryOrFirst();
		}

		if (repo == null) {
			// return a base state with an error
			return {
				...this.initialState,
				loadingError: 'No repository found. Please open a Git repository to use the Commit Composer.',
			};
		}

		// If range is explicitly provided, use it directly (skips merge target resolution)
		if (args?.range) {
			return this.initializeStateAndContextFromExplicitRange(
				repo,
				args.branchName,
				args.range,
				args.mode,
				args.source,
				args.commitShas,
			);
		}

		// Check if this is branch mode (requires merge target resolution)
		if (args?.branchName) {
			return this.initializeStateAndContextFromBranch(
				repo,
				args.branchName,
				args.mode,
				args.source,
				args.commitShas,
			);
		}

		// Default to working directory mode
		return this.initializeStateAndContextFromWorkingDirectory(
			repo,
			args?.includedUnstagedChanges,
			args?.mode,
			args?.source,
		);
	}

	private get initialState(): State {
		return {
			...this.host.baseWebviewState,
			...initialState,
		};
	}

	private async initializeStateAndContext(
		repo: Repository,
		hunks: ComposerHunk[],
		commits: ComposerCommit[],
		diffs: ComposerDiffs,
		baseCommit?: ComposerBaseCommit,
		headCommitSha?: string,
		branchName?: string,
		mode: 'experimental' | 'preview' = 'preview',
		source?: Sources,
		commitShas?: string[],
		isReload?: boolean,
	): Promise<State> {
		this._currentRepository = repo;
		this._hunks = hunks;

		const safetyState = await createSafetyState(repo, diffs, baseCommit?.sha, headCommitSha, branchName);
		this._safetyState = safetyState;
		if (branchName || (baseCommit && headCommitSha)) {
			this._recompose = {
				enabled: true,
				branchName: branchName,
				locked: true,
				commitShas: commitShas,
			};
		}

		if (commitShas && commitShas.length > 0) {
			const recomposeSet = new Set(commitShas);
			for (const commit of commits) {
				if (commit.sha && !recomposeSet.has(commit.sha)) {
					commit.locked = true;
				}
			}
		}

		const aiEnabled = this.getAiEnabled();
		const aiModel = await this.container.ai.getModel(
			{ silent: true },
			{ source: 'composer', correlationId: this.host.instanceId },
		);

		const onboardingDismissed = this.isOnboardingDismissed();
		const onboardingStepReached = this.getOnboardingStepReached();

		// Update context
		this._context.diff.files = new Set(hunks.map(h => h.fileName)).size;
		this._context.diff.hunks = hunks.length;
		this._context.diff.lines = hunks.reduce((total, hunk) => total + hunk.content.split('\n').length - 1, 0);
		this._context.commits.initialCount = 0;
		this._context.ai.enabled.org = aiEnabled.org;
		this._context.ai.enabled.config = aiEnabled.config;
		this._context.ai.model = aiModel;
		this._context.onboarding.dismissed = onboardingDismissed;
		this._context.onboarding.stepReached = onboardingStepReached;
		this._context.source = source;
		this._context.mode = mode;
		this._context.warnings.workingDirectoryChanged = false;
		this._context.warnings.indexChanged = false;
		this._context.sessionStart = new Date().toISOString();
		this.sendTelemetryEvent(isReload ? 'composer/reloaded' : 'composer/loaded');

		return {
			...this.initialState,
			hunks: hunks,
			baseCommit: baseCommit ?? null,
			commits: commits,
			aiEnabled: aiEnabled,
			ai: {
				model: aiModel,
			},
			hasChanges: commits.length > 0,
			mode: mode,
			onboardingDismissed: onboardingDismissed,
			workingDirectoryHasChanged: false,
			indexHasChanged: false,
			repositoryState: this.getRepositoryState(),
			recompose: this._recompose ?? null,
		};
	}

	private async initializeStateAndContextFromWorkingDirectory(
		repo: Repository,
		includedUnstagedChanges?: boolean,
		mode: 'experimental' | 'preview' = 'preview',
		source?: Sources,
		isReload?: boolean,
	): Promise<State> {
		// Stop repo change subscription so we can deal with untracked files
		this._repositorySubscription?.dispose();
		const untrackedPaths = (await repo.git.status?.getUntrackedFiles())?.map(f => f.path);
		if (untrackedPaths?.length) {
			try {
				await repo.git.staging?.stageFiles(untrackedPaths, { intentToAdd: true });
				this._ignoreIndexChange = true;
			} catch {}
		}

		const [diffsResult, commitResult, branchResult] = await Promise.allSettled([
			// Handle baseCommit - could be string (old format) or ComposerBaseCommit (new format)
			getComposerDiffs(repo),
			repo.git.commits.getCommit('HEAD'),
			repo.git.branches.getBranch(),
		]);

		if (untrackedPaths?.length) {
			await repo.git.staging?.unstageFiles(untrackedPaths).catch();
		}

		const diffs = getSettledValue(diffsResult)!;

		this._context.diff.unstagedIncluded = false;
		if (includedUnstagedChanges) {
			this._context.diff.unstagedIncluded = true;
		}

		// Hack for now to make sure we don't try to "mix" staged and unstaged hunks together
		const staged = this._context.diff.unstagedIncluded ? diffs?.unified : diffs?.staged;
		const unstaged = this._context.diff.unstagedIncluded ? undefined : diffs?.unstaged;

		if (!diffs?.staged?.contents && diffs?.unstaged?.contents) {
			this._context.diff.unstagedIncluded = true;
		}

		// Allow composer to open with no changes - we'll handle this in the UI
		const hasChanges = Boolean(staged?.contents || unstaged?.contents);
		const hunks = createHunksFromDiffs(staged?.contents, unstaged?.contents);
		const baseCommit = getSettledValue(commitResult);
		const currentBranch = getSettledValue(branchResult);

		// Create initial commit with empty message (user will add message later)
		const hasStagedChanges = Boolean(staged?.contents);
		const hasUnstagedChanges = Boolean(unstaged?.contents);

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
			message: { content: '', isGenerated: false },
			aiExplanation: '',
			hunkIndices: initialHunkIndices,
		};

		const commits = hasChanges ? [initialCommit] : [];

		// Update context
		this._context.diff.staged = hasStagedChanges;
		this._context.diff.unstaged = hasUnstagedChanges;
		this._context.diff.commits = false;

		// Subscribe to repository changes for working directory monitoring
		this.subscribeToRepository(repo);

		return this.initializeStateAndContext(
			repo,
			hunks,
			commits,
			diffs,
			baseCommit
				? {
						sha: baseCommit.sha,
						message: baseCommit.message ?? '',
						repoName: repo.name,
						branchName: currentBranch?.name ?? 'main',
					}
				: undefined,
			undefined,
			undefined,
			mode,
			source,
			undefined,
			isReload,
		);
	}

	private async initializeStateAndContextFromBranch(
		repo: Repository,
		branchName: string,
		mode: 'experimental' | 'preview' = 'preview',
		source?: Sources,
		commitShas?: string[],
		isReload?: boolean,
	): Promise<State> {
		// Get the branch
		const branch = await repo.git.branches.getBranch(branchName);
		if (!branch) {
			return {
				...this.initialState,
				loadingError: `Branch '${branchName}' not found.`,
			};
		}

		// Get the merge target for the branch with recursive resolution
		let mergeTargetName: string | undefined;
		let currentMergeTargetBranchName = branchName;
		let currentMergeTargetBranch = branch;
		const visitedBranches = new Set<string>();
		let attempts = 0;
		const maxAttempts = 10;

		while (attempts < maxAttempts) {
			attempts++;

			// Prevent infinite loops by tracking visited branches
			if (visitedBranches.has(currentMergeTargetBranchName)) {
				break;
			}
			visitedBranches.add(currentMergeTargetBranchName);

			const mergeTargetNameResult = await getBranchMergeTargetName(this.container, currentMergeTargetBranch);
			if (!mergeTargetNameResult.paused && mergeTargetNameResult.value) {
				mergeTargetName = mergeTargetNameResult.value;

				// Get branch commits to check if we have unique commits
				const branchData = await getBranchCommits(this.container, repo, branchName, mergeTargetName);
				if (branchData && branchData.commits.length > 0) {
					// Found unique commits, use this merge target
					const { commits: branchCommits, baseCommit, headCommitSha } = branchData;

					// Create composer commits and hunks from branch commits
					const composerData = await createComposerCommitsFromGitCommits(repo, branchCommits);
					if (!composerData) {
						return {
							...this.initialState,
							loadingError: `Failed to process commits for branch '${branchName}'.`,
						};
					}

					const { commits, hunks } = composerData;

					// Ensure that if commitShas is provided, error out if any of the commit shas are not found in the commits
					if (commitShas) {
						const commitShasSet = new Set(commitShas);
						const missingShas = [...commitShasSet].filter(sha => !commits.find(c => c.sha === sha));
						if (missingShas.length > 0) {
							return {
								...this.initialState,
								loadingError: `The following commit shas were not found in the commits for branch '${branchName}': ${missingShas.join(
									', ',
								)}`,
							};
						}
					}

					const diffs = (await getComposerDiffs(repo, { baseSha: baseCommit.sha, headSha: headCommitSha }))!;

					// Return successful state with found commits
					return this.initializeStateAndContext(
						repo,
						hunks,
						commits,
						diffs,
						{
							sha: baseCommit.sha,
							message: baseCommit.message,
							repoName: repo.name,
							branchName: branchName,
						},
						headCommitSha,
						currentMergeTargetBranchName,
						mode,
						source,
						commitShas,
						isReload,
					);
				}

				// No unique commits found, try to resolve the merge target recursively
				// Get the branch that the current merge target points to
				const targetBranch = await repo.git.branches.getBranch(mergeTargetName);
				if (!targetBranch) {
					// Can't find the target branch, stop here
					break;
				}

				// Check if the target branch name is the same as current branch (circular reference)
				if (targetBranch.name === currentMergeTargetBranchName) {
					break;
				}

				// Move to the target branch and try again
				currentMergeTargetBranchName = targetBranch.name;
				currentMergeTargetBranch = targetBranch;
			} else {
				// No merge target found or paused, stop here
				break;
			}
		}

		// If we cannot find commits using merge target, try a range to the tip of the branch
		if (commitShas?.length) {
			// Set the head commit as the tip of the branch
			const headCommitSha = branch.sha;
			// Set the base commit as the parent commit of the last commit in the range
			const baseCommitSha = (await repo.git.commits.getCommit(commitShas[0]))?.parents[0];
			if (headCommitSha && baseCommitSha) {
				return this.initializeStateAndContextFromExplicitRange(
					repo,
					branchName,
					{ base: baseCommitSha, head: headCommitSha },
					mode,
					source,
					commitShas,
					isReload,
				);
			}
		}

		// If we get here, we couldn't find unique commits to recompose with
		return {
			...this.initialState,
			loadingError: `Could not identify unique commits for branch '${branchName}'`,
		};
	}

	/**
	 * Initializes state when an explicit range is provided.
	 * This bypasses merge target resolution and uses the provided range directly.
	 */
	private async initializeStateAndContextFromExplicitRange(
		repo: Repository,
		branchName: string | undefined,
		range: { base: string; head: string },
		mode: 'experimental' | 'preview' = 'preview',
		source?: Sources,
		commitShas?: string[],
		isReload?: boolean,
	): Promise<State> {
		const { base: baseCommitSha, head: headCommitSha } = range;

		// Get the base commit
		const baseCommitResult = await repo.git.commits.getCommit(baseCommitSha);
		if (!baseCommitResult) {
			return {
				...this.initialState,
				loadingError: `Base commit '${baseCommitSha}' not found.`,
			};
		}

		// Validate head commit exists
		const headCommitResult = await repo.git.commits.getCommit(headCommitSha);
		if (!headCommitResult) {
			return {
				...this.initialState,
				loadingError: `Head commit '${headCommitSha}' not found.`,
			};
		}

		const log = await repo.git.commits.getLog(`${baseCommitSha}..${headCommitSha}`, { limit: 0 });
		if (!log?.commits?.size) {
			return {
				...this.initialState,
				loadingError: `No commits found between base commit and head commit.`,
			};
		}

		// Convert Map to Array and reverse to oldest first for processing
		const branchCommits = Array.from(log.commits.values()).reverse();

		// Create composer commits and hunks from branch commits
		const composerData = await createComposerCommitsFromGitCommits(repo, branchCommits);
		if (!composerData) {
			return {
				...this.initialState,
				loadingError: branchName
					? `Failed to process commits for branch '${branchName}'.`
					: 'Failed to process commits in range.',
			};
		}

		const { commits, hunks } = composerData;

		// Validate that all provided commitShas are found in the commits (if provided)
		if (commitShas && commitShas.length > 0) {
			const commitShasSet = new Set(commitShas);
			const missingShas = [...commitShasSet].filter(sha => !commits.find(c => c.sha === sha));
			if (missingShas.length > 0) {
				return {
					...this.initialState,
					loadingError: branchName
						? `The following commit shas were not found in the commits for branch '${branchName}': ${missingShas.join(', ')}`
						: `The following commit shas were not found in the commits: ${missingShas.join(', ')}`,
				};
			}
		}

		const diffs = (await getComposerDiffs(repo, { baseSha: baseCommitSha, headSha: headCommitSha }))!;

		const baseCommit: ComposerBaseCommit = {
			sha: baseCommitSha,
			message: baseCommitResult.message ?? '',
			repoName: repo.name,
			branchName: branchName,
		};

		// Initialize state and context, then store range in _recompose
		const state = await this.initializeStateAndContext(
			repo,
			hunks,
			commits,
			diffs,
			baseCommit,
			headCommitSha,
			branchName,
			mode,
			source,
			commitShas,
			isReload,
		);

		// Store range in _recompose for reload scenarios
		if (this._recompose) {
			this._recompose.range = range;
		}

		return state;
	}

	private getRepositoryState() {
		if (this._currentRepository == null) return undefined;

		const { id, name, path, uri, virtual } = this._currentRepository;
		return {
			current: {
				id: id,
				name: name,
				path: path,
				uri: uri.toString(),
				virtual: virtual,
			},
			hasMultipleRepositories: this.container.git.openRepositoryCount > 1,
		};
	}

	private async onAddHunksToCommit(params: OnAddHunksToCommitParams) {
		if (params.source === 'unstaged') {
			// Update context to indicate unstaged changes were included
			this._context.diff.unstagedIncluded = true;
			this.sendTelemetryEvent('composer/action/includedUnstagedChanges');

			await this.onReloadComposer({
				repoPath: this._currentRepository!.path,
				mode: this._context.mode,
			});
		}
	}

	private onUndo(): void {
		this._context.operations.undo.count++;
		this.sendTelemetryEvent('composer/action/undo');
	}

	private onRedo(): void {
		this._context.operations.redo.count++;
	}

	private onReset(): void {
		this._context.operations.reset.count++;
		this.sendTelemetryEvent('composer/action/reset');
	}

	private async onChooseRepository(): Promise<void> {
		const { title, placeholder } = await getRepositoryPickerTitleAndPlaceholder(
			this.container.git.openRepositories,
			'Switch',
			this._currentRepository?.name,
		);
		const pick = await showRepositoryPicker(
			this.container,
			title,
			placeholder,
			this.container.git.openRepositories,
			{ picked: this._currentRepository },
		);

		if (pick == null) return;

		await this.onReloadComposer({
			repoPath: pick.path,
			source: 'composer',
		});
	}

	private async onReloadComposer(params: ReloadComposerParams): Promise<void> {
		try {
			// Clear cache to force fresh data on reload
			this._cache.clear();

			let repo = this._currentRepository;
			if (!repo || (params.repoPath != null && repo?.path !== params.repoPath)) {
				// Get the best repository
				if (params.repoPath == null) {
					repo = this.container.git.getBestRepositoryOrFirst();
				} else {
					repo = this.container.git.getRepository(params.repoPath);
				}

				if (!repo) {
					// Show error in the safety error overlay
					this._context.errors.safety.count++;
					const errorMessage = 'Repository is no longer available';
					this.sendTelemetryEvent('composer/reloaded', {
						'failure.reason': 'error',
						'failure.error.message': errorMessage,
					});
					await this.host.notify(DidSafetyErrorNotification, {
						error: errorMessage,
					});
					return;
				}
			}

			// Initialize composer data from the repository
			let composerData: State;
			// If range is stored, use explicit range initialization
			if (this._recompose?.range) {
				composerData = await this.initializeStateAndContextFromExplicitRange(
					repo,
					this._recompose.branchName,
					this._recompose.range,
					params.mode,
					this._context.source,
					this._recompose.commitShas,
					true,
				);
			} else if (this._recompose?.branchName) {
				composerData = await this.initializeStateAndContextFromBranch(
					repo,
					this._recompose.branchName,
					params.mode,
					this._context.source,
					this._recompose.commitShas,
					true,
				);
			} else {
				composerData = await this.initializeStateAndContextFromWorkingDirectory(
					repo,
					this._context.diff.unstagedIncluded,
					params.mode,
					this._context.source,
					true,
				);
			}

			// Check if there was a loading error
			if (composerData.loadingError) {
				// Send loading error notification instead of reload notification
				await this.host.notify(DidLoadingErrorNotification, {
					error: composerData.loadingError,
				});
				return;
			}

			// Notify the state provider with fresh data to completely reload the state
			await this.host.notify(DidReloadComposerNotification, {
				hunks: composerData.hunks,
				commits: composerData.commits,
				baseCommit: composerData.baseCommit,
				loadingError: composerData.loadingError,
				hasChanges: composerData.hasChanges,
				repositoryState: composerData.repositoryState,
			});
		} catch (error) {
			// Show error in the safety error overlay
			this.sendTelemetryEvent('composer/reloaded', {
				'failure.reason': 'error',
				'failure.error.message': error instanceof Error ? error.message : 'unknown error',
			});
			await this.host.notify(DidLoadingErrorNotification, {
				error: error instanceof Error ? error.message : 'Failed to reload composer',
			});
		}
	}

	private async onCancelGenerateCommits(): Promise<void> {
		if (this._generateCommitsCancellation) {
			this._generateCommitsCancellation.cancel();
			await this.host.notify(DidCancelGenerateCommitsNotification, undefined);
		}
	}

	private async onCancelGenerateCommitMessage(): Promise<void> {
		if (this._generateCommitMessageCancellation) {
			this._generateCommitMessageCancellation.cancel();
			await this.host.notify(DidCancelGenerateCommitMessageNotification, undefined);
		}
	}

	private async onClearAIOperationError(): Promise<void> {
		// Send notification to clear the AI operation error
		await this.host.notify(DidClearAIOperationErrorNotification, undefined);
	}

	private onOpenOnboarding(): void {
		this.advanceOnboardingStep(1);
	}

	private onAdvanceOnboarding(params: { stepNumber: number }): void {
		this.advanceOnboardingStep(params.stepNumber);
	}

	private advanceOnboardingStep(stepNumber: number): void {
		if (this.isOnboardingDismissed()) {
			return;
		}

		const previousStepReached = this.container.storage.get('composer:onboarding:stepReached') ?? 1;
		const highestStep = Math.max(previousStepReached, stepNumber);
		this._context.onboarding.stepReached = highestStep;
		void this.container.storage.store('composer:onboarding:stepReached', highestStep).catch();
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

	private getOnboardingStepReached(): number | undefined {
		return this.container.storage.get('composer:onboarding:stepReached');
	}

	private resetContext(): void {
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
			this.resetContext();
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
		this._context.sessionDuration = Date.now() - new Date(this._context.sessionStart).getTime();
		await commands.executeCommand('workbench.action.closeActiveEditor');
	}

	private async updateAiModel(): Promise<void> {
		try {
			const model = await this.container.ai.getModel(
				{ silent: true },
				{ source: 'composer', correlationId: this.host.instanceId },
			);
			this._context.ai.model = model;
			this.sendTelemetryEvent('composer/action/changeAiModel');
			await this.host.notify(DidChangeAiModelNotification, { model: model });
		} catch {
			// Ignore errors when getting AI model
		}
	}

	private async onSelectAIModel(): Promise<void> {
		// Trigger the AI provider/model switch command
		await commands.executeCommand<Source>('gitlens.ai.switchProvider', {
			source: 'composer',
			correlationId: this.host.instanceId,
			detail: 'model-picker',
		});
	}

	private async onAIFeedbackHelpful(params: AIFeedbackParams): Promise<void> {
		// Send AI feedback for composer auto-composition
		this._context.operations.generateCommits.feedback.upvoteCount++;
		await this.sendComposerAIFeedback('helpful', params.sessionId);
	}

	private async onAIFeedbackUnhelpful(params: AIFeedbackParams): Promise<void> {
		// Send AI feedback for composer auto-composition
		this._context.operations.generateCommits.feedback.downvoteCount++;
		await this.sendComposerAIFeedback('unhelpful', params.sessionId);
	}

	private async sendComposerAIFeedback(sentiment: 'helpful' | 'unhelpful', sessionId: string | null): Promise<void> {
		try {
			// Get the current AI model
			const model = await this.container.ai.getModel(
				{ silent: true },
				{ source: 'composer', correlationId: this.host.instanceId },
			);
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
			sendFeedbackEvent(
				this.container,
				{ source: 'composer', correlationId: this.host.instanceId },
				context,
				sentiment,
				unhelpful,
			);
		} catch (error) {
			// Log error but don't throw to avoid breaking the UI
			console.error('Failed to send composer AI feedback:', error);
		}
	}

	private subscribeToRepository(repository: Repository): void {
		// Dispose existing subscription
		this._repositorySubscription?.dispose();

		// Subscribe to repository changes
		this._repositorySubscription = Disposable.from(
			repository.watchFileSystem(1000),
			repository.onDidChangeFileSystem(this.onRepositoryFileSystemChanged, this),
			repository.onDidChange(this.onRepositoryChanged, this),
		);
	}

	private async onRepositoryChanged(e: RepositoryChangeEvent): Promise<void> {
		if (e.repository.id !== this._currentRepository?.id) return;
		const ignoreIndexChange = this._ignoreIndexChange;
		this._ignoreIndexChange = false;
		// Only care about index changes (staged/unstaged changes)
		if (
			!e.changed(RepositoryChange.Index, RepositoryChangeComparisonMode.Any) ||
			(ignoreIndexChange && e.changed(RepositoryChange.Index, RepositoryChangeComparisonMode.Exclusive))
		) {
			return;
		}

		this._context.warnings.indexChanged = true;
		await this.host.notify(DidIndexChangeNotification, undefined);
	}

	private async onRepositoryFileSystemChanged(e: RepositoryFileSystemChangeEvent): Promise<void> {
		// Working directory files have changed
		if (e.repository.id !== this._currentRepository?.id) return;

		this._context.warnings.workingDirectoryChanged = true;
		await this.host.notify(DidWorkingDirectoryChangeNotification, undefined);
	}

	private async onGenerateCommits(params: GenerateCommitsParams): Promise<void> {
		const eventData: ComposerGenerateCommitsEventData = {
			'customInstructions.used': false,
			'customInstructions.length': 0,
			'customInstructions.hash': '',
			'customInstructions.setting.used': false,
			'customInstructions.setting.length': 0,
		};
		try {
			const generateCommitsInstructionSetting = configuration.get('ai.generateCommits.customInstructions');
			if (generateCommitsInstructionSetting) {
				eventData['customInstructions.setting.used'] = true;
				eventData['customInstructions.setting.length'] = generateCommitsInstructionSetting.length;
			}

			this._context.operations.generateCommits.count++;
			if (params.customInstructions) {
				eventData['customInstructions.used'] = true;
				eventData['customInstructions.length'] = params.customInstructions.length;
				eventData['customInstructions.hash'] = md5(params.customInstructions);
			}

			// Create cancellation token for this operation
			this._generateCommitsCancellation = new CancellationTokenSource();

			// Notify webview that generation is starting
			await this.host.notify(DidStartGeneratingNotification, undefined);

			// Transform the data for the AI service
			const hunks = [];

			if (this._recompose?.enabled && this._safetyState?.hashes.commits) {
				// In recompose mode, we need to break down the commit history and use the combined diff to generate new hunks
				// before sending them off to the AI service to compose new commits
				const baseSha = params.commitsToReplace?.baseShaForNewDiff ?? this._safetyState.baseSha!;
				let headSha = this._safetyState.headSha!;
				if (params.commitsToReplace?.commits?.length) {
					headSha =
						params.commitsToReplace.commits[params.commitsToReplace.commits.length - 1].sha ??
						this._safetyState.headSha!;
				}

				const shouldSkipDiffCalculation =
					params.commitsToReplace?.commits?.length && params.commitsToReplace.commits.every(c => !c.sha);
				if (shouldSkipDiffCalculation) {
					// just set hunks to the existing hunks and move on
					const hunkIndices = new Set(params.commitsToReplace!.commits.flatMap(c => c.hunkIndices));
					for (const index of hunkIndices) {
						hunks.push({ ...this._hunks.find(m => m.index === index)!, assigned: true });
					}
				} else {
					const combinedDiff = await calculateCombinedDiffBetweenCommits(
						this._currentRepository!,
						baseSha,
						headSha,
					);

					const combinedHunks = createHunksFromDiffs(combinedDiff!.contents);
					for (const hunk of combinedHunks) {
						const { author, coAuthors } = getAuthorAndCoAuthorsForCombinedDiffHunk(this._hunks, hunk);
						hunk.author = author;
						hunk.coAuthors = coAuthors.length ? coAuthors : undefined;
						hunks.push({ ...hunk, assigned: true });
					}

					// Update the hunks. Note that if params.commitsToReplace is defined, then we need to remove all the hunks with indices that match the hunkIndices of the commits to replace, then add in the new hunks and
					// reinder all of the hunks. Otherwise, we just replace the existing hunks with the new ones
					if (params.commitsToReplace) {
						const hunkIndicesToRemove = new Set(
							params.commitsToReplace.commits.flatMap(c => c.hunkIndices),
						);
						this._hunks = this._hunks.filter(h => !hunkIndicesToRemove.has(h.index));
						// Reindex the hunks
						let newIndexCounter = 1;
						this._hunks.forEach(hunk => {
							hunk.index = newIndexCounter++;
						});
						hunks.forEach(hunk => {
							hunk.index = newIndexCounter++;
						});
						this._hunks.push(...hunks);
					} else {
						this._hunks = hunks;
					}
				}
			} else {
				// Working directory mode: use existing hunks
				for (const index of params.hunkIndices) {
					hunks.push({ ...this._hunks.find(m => m.index === index)!, assigned: true });
				}
			}

			const existingCommits = params.commits.map(commit => ({
				id: commit.id,
				message: commit.message.content,
				aiExplanation: commit.aiExplanation,
				hunkIndices: commit.hunkIndices,
			}));

			// Call the AI service
			const result = await this.container.ai.actions.generateCommits(
				hunks,
				existingCommits,
				hunks.map(m => ({ index: m.index, hunkHeader: m.hunkHeader })),
				{ source: 'composer', correlationId: this.host.instanceId },
				{
					cancellation: this._generateCommitsCancellation.token,
					customInstructions: params.customInstructions,
				},
			);

			if (this._generateCommitsCancellation?.token.isCancellationRequested) {
				this._context.operations.generateCommits.cancelledCount++;
				this.sendTelemetryEvent(
					params.isRecompose ? 'composer/action/recompose/failed' : 'composer/action/compose/failed',
					{
						...eventData,
						'failure.reason': 'cancelled',
					},
				);
				await this.host.notify(DidCancelGenerateCommitsNotification, undefined);
				return;
			}

			if (result && result !== 'cancelled') {
				if (result.commits.length === 0) {
					this._context.operations.generateCommits.errorCount++;
					this._context.errors.operation.count++;
					this.sendTelemetryEvent(
						params.isRecompose ? 'composer/action/recompose/failed' : 'composer/action/compose/failed',
						{
							...eventData,
							'failure.reason': 'error',
							'failure.error.message': 'no commits generated',
						},
					);
					await this.host.notify(DidErrorAIOperationNotification, {
						operation: 'generate commits',
						error: 'No commits generated',
					});
					return;
				}

				// Transform AI result back to ComposerCommit format
				const newCommits = result.commits.map((commit, index) => ({
					id: `ai-commit-${index}`,
					message: { content: commit.message, isGenerated: true },
					aiExplanation: commit.explanation,
					hunkIndices: commit.hunks.map(h => h.hunk),
				}));

				// Notify the webview with the generated commits (this will also clear loading state)
				this._context.commits.autoComposedCount = newCommits.length;
				this.sendTelemetryEvent(
					params.isRecompose ? 'composer/action/recompose' : 'composer/action/compose',
					eventData,
				);

				// Unlock the commits in recompose mode after a successful auto-compose since they are now draft commits
				if (this._recompose?.enabled) {
					this._recompose.locked = false;
				}

				await this.host.notify(DidGenerateCommitsNotification, {
					commits: newCommits,
					// In recompose mode, we generated a new combined diff and hunks, so we need to pass the hunks back to state
					hunks: this._recompose?.enabled ? this._hunks : undefined,
					replacedCommitIds: params.commitsToReplace?.commits.map(c => c.id),
				});
			} else if (result === 'cancelled') {
				this._context.operations.generateCommits.cancelledCount++;
				// Send cancellation notification instead of success notification
				await this.host.notify(DidCancelGenerateCommitsNotification, undefined);
			} else {
				this._context.operations.generateCommits.errorCount++;
				this._context.errors.operation.count++;
				// Send error notification for failure (not cancellation)
				this.sendTelemetryEvent(
					params.isRecompose ? 'composer/action/recompose/failed' : 'composer/action/compose/failed',
					{
						...eventData,
						'failure.reason': 'error',
						'failure.error.message': 'unknown error',
					},
				);
				await this.host.notify(DidErrorAIOperationNotification, {
					operation: 'generate commits',
					error: undefined,
				});
			}
		} catch (error) {
			// Check if this was a cancellation or a real error
			if (this._generateCommitsCancellation?.token.isCancellationRequested) {
				this._context.operations.generateCommits.cancelledCount++;
				// Send cancellation notification
				this.sendTelemetryEvent(
					params.isRecompose ? 'composer/action/recompose/failed' : 'composer/action/compose/failed',
					{
						...eventData,
						'failure.reason': 'cancelled',
					},
				);
				await this.host.notify(DidCancelGenerateCommitsNotification, undefined);
			} else {
				this._context.operations.generateCommits.errorCount++;
				this._context.errors.operation.count++;
				this.sendTelemetryEvent(
					params.isRecompose ? 'composer/action/recompose/failed' : 'composer/action/compose/failed',
					{
						...eventData,
						'failure.reason': 'error',
						'failure.error.message': error instanceof Error ? error.message : 'unknown error',
					},
				);
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
		const eventData: ComposerGenerateCommitMessageEventData = {
			'customInstructions.setting.used': false,
			'customInstructions.setting.length': 0,
			overwriteExistingMessage: params.overwriteExistingMessage ?? false,
		};
		try {
			const customInstructionsSetting = configuration.get('ai.generateCommitMessage.customInstructions');
			if (customInstructionsSetting) {
				eventData['customInstructions.setting.used'] = true;
				eventData['customInstructions.setting.length'] = customInstructionsSetting.length;
			}

			this._context.operations.generateCommitMessage.count++;

			// Create cancellation token for this operation
			this._generateCommitMessageCancellation = new CancellationTokenSource();

			// Notify webview that commit message generation is starting
			await this.host.notify(DidStartGeneratingCommitMessageNotification, { commitId: params.commitId });

			// Create combined diff for the commit
			const { patch } = createCombinedDiffForCommit(
				this._hunks.filter(h => params.commitHunkIndices.includes(h.index)),
			);
			if (!patch) {
				this._context.operations.generateCommitMessage.errorCount++;
				this._context.errors.operation.count++;
				// Send error notification for failure (not cancellation)
				this.sendTelemetryEvent('composer/action/generateCommitMessage/failed', {
					...eventData,
					'failure.reason': 'error',
					'failure.error.message': 'Failed to create diff for commit',
				});
				await this.host.notify(DidErrorAIOperationNotification, {
					operation: 'generate commit message',
					error: 'Failed to create diff for commit',
				});
			}

			// Call the AI service to generate commit message
			const result = await this.container.ai.actions.generateCommitMessage(
				patch,
				{ source: 'composer', correlationId: this.host.instanceId },
				{
					cancellation: this._generateCommitMessageCancellation.token,
				},
			);

			if (this._generateCommitMessageCancellation?.token.isCancellationRequested) {
				this._context.operations.generateCommitMessage.cancelledCount++;
				this.sendTelemetryEvent('composer/action/generateCommitMessage/failed', {
					...eventData,
					'failure.reason': 'cancelled',
				});
				await this.host.notify(DidCancelGenerateCommitMessageNotification, undefined);
				return;
			}

			if (result && result !== 'cancelled') {
				// Combine summary and body into a single message
				const message = result.result.body
					? `${result.result.summary}\n\n${result.result.body}`
					: result.result.summary;

				// Notify the webview with the generated commit message
				this.sendTelemetryEvent('composer/action/generateCommitMessage', eventData);
				await this.host.notify(DidGenerateCommitMessageNotification, {
					commitId: params.commitId,
					message: message,
				});
			} else if (result === 'cancelled') {
				this._context.operations.generateCommitMessage.cancelledCount++;
				// Send cancellation notification instead of success notification
				this.sendTelemetryEvent('composer/action/generateCommitMessage/failed', {
					...eventData,
					'failure.reason': 'cancelled',
				});
				await this.host.notify(DidCancelGenerateCommitMessageNotification, undefined);
			} else {
				this._context.operations.generateCommitMessage.errorCount++;
				this._context.errors.operation.count++;
				// Send error notification for failure (not cancellation)
				this.sendTelemetryEvent('composer/action/generateCommitMessage/failed', {
					...eventData,
					'failure.reason': 'error',
					'failure.error.message': 'unknown error',
				});
				await this.host.notify(DidErrorAIOperationNotification, {
					operation: 'generate commit message',
					error: undefined,
				});
			}
		} catch (error) {
			// Check if this was a cancellation or a real error
			if (this._generateCommitMessageCancellation?.token.isCancellationRequested) {
				this._context.operations.generateCommitMessage.cancelledCount++;
				// Send cancellation notification
				this.sendTelemetryEvent('composer/action/generateCommitMessage/failed', {
					...eventData,
					'failure.reason': 'cancelled',
				});
				await this.host.notify(DidCancelGenerateCommitMessageNotification, undefined);
			} else {
				this._context.operations.generateCommitMessage.errorCount++;
				this._context.errors.operation.count++;
				// Send error notification for exception
				this.sendTelemetryEvent('composer/action/generateCommitMessage/failed', {
					...eventData,
					'failure.reason': 'error',
					'failure.error.message': error instanceof Error ? error.message : 'unknown error',
				});
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
			const repo = this.container.git.getRepository(this._safetyState.repoPath);
			if (!repo) {
				// Clear loading state and show safety error
				await this.host.notify(DidFinishCommittingNotification, undefined);
				this._context.errors.safety.count++;
				this._context.errors.operation.count++;
				const errorMessage = 'Repository is no longer available';
				this.sendTelemetryEvent('composer/action/finishAndCommit/failed', {
					'failure.reason': 'error',
					'failure.error.message': errorMessage,
				});
				await this.host.notify(DidSafetyErrorNotification, {
					error: errorMessage,
				});
				return;
			}

			const commitHunkIndices = params.commits.flatMap(c => c.hunkIndices);
			const hunks: ComposerHunk[] = [];
			for (const hunk of commitHunkIndices) {
				hunks.push({ ...this._hunks.find(m => m.index === hunk)!, assigned: true });
			}

			const hunksBeingCommitted = hunks.filter(hunk =>
				params.commits.some(c => c.hunkIndices.includes(hunk.index)),
			);

			// Validate repository safety state before proceeding
			// Stop repo change subscription so we can deal with untracked files
			let diffsWithUntracked: ComposerDiffs | undefined;
			if (this._context.diff.unstagedIncluded) {
				this._repositorySubscription?.dispose();
				const untrackedPaths = (await repo.git.status?.getUntrackedFiles())?.map(f => f.path);
				if (untrackedPaths?.length) {
					try {
						diffsWithUntracked = await getComposerDiffs(repo);
						await repo.git.staging?.stageFiles(untrackedPaths);
					} catch {}
				}
			}

			const validation = await validateSafetyState(
				repo,
				this._safetyState,
				hunksBeingCommitted,
				diffsWithUntracked,
			);
			if (!validation.isValid) {
				// Clear loading state and show safety error
				await this.host.notify(DidFinishCommittingNotification, undefined);
				this._context.errors.safety.count++;
				this._context.errors.operation.count++;
				this._context.operations.finishAndCommit.errorCount++;
				const errorMessage = validation.errors.join('\n');
				this.sendTelemetryEvent('composer/action/finishAndCommit/failed', {
					'failure.reason': 'error',
					'failure.error.message': errorMessage,
				});
				await this.host.notify(DidSafetyErrorNotification, {
					error: errorMessage,
				});
				return;
			}

			const diffInfo = convertToComposerDiffInfo(params.commits, hunks);
			const svc = this.container.git.getRepositoryService(repo.path);
			if (!svc) {
				this._context.errors.operation.count++;
				this._context.operations.finishAndCommit.errorCount++;
				const errorMessage = 'No repository service found';
				this.sendTelemetryEvent('composer/action/finishAndCommit/failed', {
					'failure.reason': 'error',
					'failure.error.message': errorMessage,
				});
				throw new Error(errorMessage);
			}

			if (params.baseCommit?.sha == null) {
				const initialCommitSha = await svc.patch?.createEmptyInitialCommit();
				if (initialCommitSha == null) {
					// error base we don't have an initial commit
					this._context.errors.operation.count++;
					this._context.operations.finishAndCommit.errorCount++;
					const errorMessage = 'Could not create base commit';
					this.sendTelemetryEvent('composer/action/finishAndCommit/failed', {
						'failure.reason': 'error',
						'failure.error.message': errorMessage,
					});
					throw new Error(errorMessage);
				}
			}

			// Create unreachable commits from patches
			const shas = await repo.git.patch?.createUnreachableCommitsFromPatches(params.baseCommit?.sha, diffInfo);

			if (!shas?.length) {
				this._context.errors.operation.count++;
				this._context.operations.finishAndCommit.errorCount++;
				const errorMessage = 'Failed to create commits from patches';
				this.sendTelemetryEvent('composer/action/finishAndCommit/failed', {
					'failure.reason': 'error',
					'failure.error.message': errorMessage,
				});
				throw new Error(errorMessage);
			}

			const baseRef = params.baseCommit?.sha ?? ((await repo.git.commits.getCommit('HEAD')) ? 'HEAD' : rootSha);
			const resultingDiff = (
				await repo.git.diff.getDiff?.(shas[shas.length - 1], baseRef, {
					notation: params.baseCommit?.sha ? '...' : undefined,
				})
			)?.contents;

			if (!resultingDiff) {
				this._context.errors.operation.count++;
				this._context.operations.finishAndCommit.errorCount++;
				const errorMessage = 'Failed to get combined diff';
				this.sendTelemetryEvent('composer/action/finishAndCommit/failed', {
					'failure.reason': 'error',
					'failure.error.message': errorMessage,
				});
				throw new Error(errorMessage);
			}

			if (
				!validateResultingDiff(
					this._safetyState,
					await sha256(resultingDiff),
					this._context.diff.unstagedIncluded,
				)
			) {
				// Clear loading state and show safety error
				await this.host.notify(DidFinishCommittingNotification, undefined);
				this._context.errors.safety.count++;
				this._context.errors.operation.count++;
				this._context.operations.finishAndCommit.errorCount++;
				const errorMessage = 'Output diff does not match input';
				this.sendTelemetryEvent('composer/action/finishAndCommit/failed', {
					'failure.reason': 'error',
					'failure.error.message': errorMessage,
				});
				await this.host.notify(DidSafetyErrorNotification, {
					error: errorMessage,
				});
				return;
			}

			// Capture previous stash state
			let previousStashCommit;
			let stash;
			let stashCommit;
			let stashedSuccessfully = false;
			const hasWorkingChanges = await repo.git.status.hasWorkingChanges({ throwOnError: true });
			if (hasWorkingChanges) {
				stash = await svc.stash?.getStash();
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
				if (stash?.stashes.size) {
					stashCommit = stash.stashes.values().next().value;
					if (
						stashCommit &&
						stashCommit.ref !== previousStashCommit?.ref &&
						stashCommit.message?.includes(stashMessage)
					) {
						stashedSuccessfully = true;
					}
				}
			}

			// Check if we're in branch mode
			if (this._recompose?.enabled && this._recompose.branchName) {
				// Branch mode: update the specific branch to point to the new commits
				// Use git update-ref to update the branch reference directly
				await repo.git.refs.updateReference(`refs/heads/${this._recompose.branchName}`, shas[shas.length - 1]);
			} else {
				// Working directory mode: reset the current branch to the new shas
				await svc.ops?.reset(shas[shas.length - 1], { mode: 'hard' });
			}

			// Pop the stash we created to restore what is left in the working tree
			if (stashCommit && stashedSuccessfully) {
				await svc.stash?.applyStash(stashCommit.stashName, { deleteAfter: true });
			}

			// Clear the committing state and close the composer webview first
			this._context.commits.finalCount = shas.length;
			this.sendTelemetryEvent('composer/action/finishAndCommit');
			await this.host.notify(DidFinishCommittingNotification, undefined);
			void commands.executeCommand('workbench.action.closeActiveEditor');
		} catch (error) {
			// Clear loading state on error
			this._context.errors.operation.count++;
			this._context.operations.finishAndCommit.errorCount++;
			const errorMessage = error instanceof Error ? error.message : 'unknown error';
			this.sendTelemetryEvent('composer/action/finishAndCommit/failed', {
				'failure.reason': 'error',
				'failure.error.message': errorMessage,
			});
			await this.host.notify(DidFinishCommittingNotification, undefined);
			void window.showErrorMessage(`Failed to commit changes: ${errorMessage}`);
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

	private sendTelemetryEvent(
		event: 'composer/action/compose' | 'composer/action/recompose',
		data: ComposerGenerateCommitsEventData,
	): void;
	private sendTelemetryEvent(
		event: 'composer/action/compose/failed' | 'composer/action/recompose/failed',
		data: ComposerGenerateCommitsEventData & ComposerActionEventFailureData,
	): void;
	private sendTelemetryEvent(
		event: 'composer/action/generateCommitMessage',
		data: ComposerGenerateCommitMessageEventData,
	): void;
	private sendTelemetryEvent(
		event: 'composer/action/generateCommitMessage/failed',
		data: ComposerGenerateCommitMessageEventData & ComposerActionEventFailureData,
	): void;
	private sendTelemetryEvent(
		event: 'composer/action/finishAndCommit/failed',
		data: ComposerActionEventFailureData,
	): void;
	private sendTelemetryEvent(event: 'composer/loaded' | 'composer/reloaded', data?: ComposerLoadedErrorData): void;
	private sendTelemetryEvent(
		event:
			| 'composer/action/includedUnstagedChanges'
			| 'composer/action/changeAiModel'
			| 'composer/action/finishAndCommit'
			| 'composer/action/undo'
			| 'composer/action/reset'
			| 'composer/warning/workingDirectoryChanged'
			| 'composer/warning/indexChanged',
	): void;
	private sendTelemetryEvent(event: ComposerTelemetryEvent, data?: any): void {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent(event, {
			...this.getTelemetryContext(),
			...data,
		});
	}

	private _panelWasVisible: boolean | undefined;
	private _isMaximized = false;

	async maximize(): Promise<void> {
		if (this._isMaximized) {
			// Restore panel if it was previously visible
			if (this._panelWasVisible) {
				await executeCoreCommand('workbench.action.togglePanel');
			}
			this._isMaximized = false;
			this._panelWasVisible = undefined;
		} else {
			// Check panel visibility by querying the workbench state
			// We'll use a workaround: check if the panel is focused
			try {
				// Try to focus the panel - if it succeeds, panel was visible
				await executeCoreCommand('workbench.action.focusPanel');
				this._panelWasVisible = true;
				// Now hide it
				await executeCoreCommand('workbench.action.togglePanel');
			} catch {
				// If focusing failed, panel wasn't visible
				this._panelWasVisible = false;
			}

			this._isMaximized = true;
		}
	}
}
