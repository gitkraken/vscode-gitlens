import type { Disposable, TextDocument } from 'vscode';
import { ViewColumn, workspace } from 'vscode';
import { getAvatarUri, getAvatarUriFromGravatarEmail } from '../../avatars';
import type { RebaseEditorTelemetryContext } from '../../constants.telemetry';
import type { Container } from '../../container';
import { emojify } from '../../emojis';
import {
	abortPausedOperation,
	continuePausedOperation,
	showPausedOperationStatus,
	skipPausedOperation,
} from '../../git/actions/pausedOperation';
import type { GitCommit } from '../../git/models/commit';
import type { ProcessedRebaseTodo, RebaseTodoAction } from '../../git/models/rebase';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../git/models/repository';
import { processRebaseEntries, readAndParseRebaseDoneFile } from '../../git/utils/-webview/rebase.parsing.utils';
import { reopenRebaseTodoEditor } from '../../git/utils/-webview/rebase.utils';
import { createReference } from '../../git/utils/reference.utils';
import type { Subscription } from '../../plus/gk/models/subscription';
import { isSubscriptionTrialOrPaidFromState } from '../../plus/gk/utils/subscription.utils';
import { executeCommand, executeCoreCommand } from '../../system/-webview/command';
import { configuration } from '../../system/-webview/configuration';
import { closeTab } from '../../system/-webview/vscode/tabs';
import { exists } from '../../system/-webview/vscode/uris';
import type { Deferrable } from '../../system/function/debounce';
import { debounce } from '../../system/function/debounce';
import { concat, filterMap, find, first, join, last, map } from '../../system/iterable';
import { getSettledValue } from '../../system/promise';
import type { ComposerWebviewShowingArgs } from '../plus/composer/registration';
import type { ShowInCommitGraphCommandArgs } from '../plus/graph/registration';
import type { IpcMessage } from '../protocol';
import type { WebviewHost } from '../webviewProvider';
import type { WebviewPanelShowCommandArgs } from '../webviewsController';
import type {
	Author,
	ChangeEntriesParams,
	ChangeEntryParams,
	Commit,
	GetMissingAvatarsParams,
	GetMissingCommitsParams,
	GetPotentialConflictsParams,
	MoveEntriesParams,
	MoveEntryParams,
	RebaseActiveStatus,
	RebaseEntry,
	RebasePauseReason,
	ReorderParams,
	RevealRefParams,
	ShiftEntriesParams,
	State,
	UpdateSelectionParams,
} from './protocol';
import {
	AbortCommand,
	ChangeEntriesCommand,
	ChangeEntryCommand,
	ContinueCommand,
	DidChangeAvatarsNotification,
	DidChangeCommitsNotification,
	DidChangeNotification,
	DidChangeSubscriptionNotification,
	GetMissingAvatarsCommand,
	GetMissingCommitsCommand,
	GetPotentialConflictsRequest,
	MoveEntriesCommand,
	MoveEntryCommand,
	RecomposeCommand,
	ReorderCommand,
	RevealRefCommand,
	SearchCommand,
	ShiftEntriesCommand,
	SkipCommand,
	StartCommand,
	SwitchCommand,
	UpdateSelectionCommand,
} from './protocol';
import { RebaseTodoDocument } from './rebaseTodoDocument';

export const maxSmallIntegerV8 = 2 ** 30 - 1;

interface Enrichment {
	commits: Map<string, GitCommit>;
	authors: Map<string, Author>;
	onto: { sha: string; commit?: GitCommit | undefined } | undefined;
}

export class RebaseWebviewProvider implements Disposable {
	private _branchName?: string | null;
	private _closing: boolean = false;
	private readonly _disposables: Disposable[] = [];
	private _enrichment: Enrichment;
	private readonly _todoDocument: RebaseTodoDocument;

	private get ascending() {
		return configuration.get('rebaseEditor.ordering') === 'asc';
	}

	/** Computes whether the commits are already in place (parent of first commit is the onto commit) */
	private computeIsInPlace(processed?: ProcessedRebaseTodo): boolean {
		processed ??= this._todoDocument.parsed.processed;
		const { commits, onto: ontoCommit } = this._enrichment;

		const firstShortSha = first(processed.commits.keys());
		if (firstShortSha == null || ontoCommit?.sha == null) return false;

		const firstCommit = commits.get(firstShortSha);
		if (firstCommit == null) return false;

		// Use short SHA comparison - onto.sha is already a short SHA
		return firstCommit.parents.some(parent => parent.startsWith(ontoCommit.sha));
	}

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.rebase'>,
		document: TextDocument,
		private readonly repoPath: string,
	) {
		this._enrichment = { commits: new Map(), authors: new Map(), onto: undefined };
		this._todoDocument = new RebaseTodoDocument(document);

		this._disposables.push(
			workspace.onDidChangeTextDocument(e => {
				if (!this._closing && e.document === document && e.contentChanges.length) {
					// Don't refresh (which reloads the webview), just update state
					this.updateState();
				}
			}),
			workspace.onDidSaveTextDocument(e => {
				if (!this._closing && e === document) {
					// Don't refresh (which reloads the webview), just update state
					this.updateState();
				}
			}),
			// Close the editor if the document is closed (e.g., file deleted)
			workspace.onDidCloseTextDocument(e => {
				if (e === document) {
					this._closing = true;
					void closeTab(document.uri);
				}
			}),
			this.container.subscription.onDidChange(e => {
				this.onSubscriptionChanged(e.current);
			}),
		);

		// Subscribe to repository changes
		const repo = this.container.git.getRepository(this.repoPath);
		if (repo != null) {
			this._disposables.push(
				repo.onDidChange(async e => {
					if (e.changed(RepositoryChange.Rebase, RepositoryChangeComparisonMode.Any)) {
						// Check if the rebase todo file still exists, if not close the editor
						if (await exists(this._todoDocument.uri)) {
							this.updateState();
						} else if (!this._closing) {
							this._closing = true;
							void closeTab(this._todoDocument.uri);
						}
					} else if (e.changed(RepositoryChange.Index, RepositoryChangeComparisonMode.Any)) {
						// Refresh when index changes to update conflict state during paused rebase
						this.updateState();
					}
				}),
			);
		}
	}

	dispose(): void {
		this._disposables.forEach(d => void d.dispose());
	}

	getTelemetryContext(): RebaseEditorTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
			'context.ascending': this.ascending,
		};
	}

	async includeBootstrap(deferrable?: boolean): Promise<State> {
		if (deferrable) {
			return Promise.resolve({
				webviewId: this.host.id,
				webviewInstanceId: this.host.instanceId,
				timestamp: Date.now(),
			} as State);
		}

		return this.parseState();
	}

	registerCommands(): Disposable[] {
		return [
			this.host.registerWebviewCommand('gitlens.pausedOperation.showConflicts:rebase', () =>
				this.onShowConflicts(),
			),
		];
	}

	onMessageReceived(e: IpcMessage): void {
		switch (true) {
			case AbortCommand.is(e):
				void this.onAbort();
				break;

			case ContinueCommand.is(e):
				void this.onContinue();
				break;

			case SearchCommand.is(e):
				void executeCoreCommand('editor.action.webvieweditor.showFind');
				break;

			case SkipCommand.is(e):
				void this.onSkip();
				break;

			case StartCommand.is(e):
				void this.onStart();
				break;

			case SwitchCommand.is(e):
				void this.onSwitchToText();
				break;

			case ReorderCommand.is(e):
				void this.onSwapOrdering(e.params);
				break;

			case ChangeEntryCommand.is(e):
				void this.onEntryChanged(e.params);
				break;

			case ChangeEntriesCommand.is(e):
				void this.onEntriesChanged(e.params);
				break;

			case MoveEntryCommand.is(e):
				void this.onEntryMoved(e.params);
				break;

			case MoveEntriesCommand.is(e):
				void this.onEntriesMoved(e.params);
				break;

			case ShiftEntriesCommand.is(e):
				void this.onEntriesShifted(e.params);
				break;

			case UpdateSelectionCommand.is(e):
				this.onSelectionChanged(e.params);
				break;

			case RevealRefCommand.is(e):
				void this.onRevealRef(e.params);
				break;

			case GetMissingAvatarsCommand.is(e):
				void this.onGetMissingAvatars(e.params);
				break;

			case GetMissingCommitsCommand.is(e):
				void this.onGetMissingCommits(e.params);
				break;

			case GetPotentialConflictsRequest.is(e):
				void this.onGetPotentialConflicts(GetPotentialConflictsRequest, e);
				break;

			case RecomposeCommand.is(e):
				void this.onRecompose();
				break;
		}
	}

	onRefresh(_force?: boolean): void {
		this.updateState(true);
	}

	onVisibilityChanged(visible: boolean): void {
		if (visible) {
			// If there was a pending change while hidden, update now
			this.updateState();
		}
	}

	private onSubscriptionChanged(subscription: Subscription): void {
		if (!this.host.visible) return;

		void this.host.notify(DidChangeSubscriptionNotification, { subscription: subscription });
	}

	private async onAbort(): Promise<void> {
		this._closing = true;

		// Delete the contents to abort the rebase
		await this._todoDocument.clear();
		await this._todoDocument.save();

		const svc = this.container.git.getRepositoryService(this.repoPath);
		await abortPausedOperation(svc);
		await closeTab(this._todoDocument.uri);
	}

	private async onContinue(): Promise<void> {
		// Save the document first to ensure any changes are persisted
		await this._todoDocument.save();

		const svc = this.container.git.getRepositoryService(this.repoPath);
		await continuePausedOperation(svc);
	}

	private async onRecompose(): Promise<void> {
		// Get commit SHAs from the rebase entries
		const { processed } = this._todoDocument.parsed;

		const firstShortSha = first(processed.commits.keys())!;
		const ontoShortSha = this._enrichment.onto!.sha;

		// Get the base commit SHA from the onto commit (the commit we're rebasing onto)
		const headShortSha = last(processed.commits.keys())!;
		const { commits } = await this.getAndUpdateCommits([headShortSha, ontoShortSha, firstShortSha]);

		const ontoCommit = commits.get(ontoShortSha)!;
		const firstCommit = commits.get(firstShortSha)!;

		let baseCommitSha = ontoCommit.sha;
		if (!firstCommit.parents.includes(baseCommitSha)) {
			baseCommitSha = firstCommit.parents[0];
		}

		const headCommitSha = commits.get(headShortSha)!.sha;

		// Open the Commit Composer with the commits
		void executeCommand<WebviewPanelShowCommandArgs<ComposerWebviewShowingArgs>>(
			'gitlens.showComposerPage',
			undefined,
			{
				repoPath: this.repoPath,
				source: 'rebaseEditor',
				mode: 'preview',
				branchName: this._branchName ?? undefined,
				range: { base: baseCommitSha, head: headCommitSha },
			},
		);

		await this.onAbort();
	}

	private async onShowConflicts(): Promise<void> {
		await showPausedOperationStatus(this.container, this.repoPath);
	}

	private async onSkip(): Promise<void> {
		const svc = this.container.git.getRepositoryService(this.repoPath);
		await skipPausedOperation(svc);
	}

	private async onStart(): Promise<void> {
		this._closing = true;

		await this._todoDocument.save();
		await closeTab(this._todoDocument.uri);
	}

	private async onSwapOrdering(params: ReorderParams): Promise<void> {
		await configuration.updateEffective('rebaseEditor.ordering', (params.ascending ?? false) ? 'asc' : 'desc');
		this.updateState(true);
	}

	private onSwitchToText(): Promise<void> {
		return reopenRebaseTodoEditor('default');
	}

	/** Fetches enhanced avatars (from GitHub/GitLab/etc.) for the requested emails */
	private async onGetMissingAvatars(params: GetMissingAvatarsParams): Promise<void> {
		if (!this._enrichment?.authors.size || !this.repoPath) return;

		const { authors } = this._enrichment;

		const promises: Promise<void>[] = [];
		let hasUpdates = false;

		for (const [email, sha] of Object.entries(params.emails)) {
			// Find the author by email to update their avatar
			const author = find(authors.values(), a => a.email === email);
			if (!author) continue;

			const avatarUrlOrPromise = author.avatarUrl ?? getAvatarUri(email, { ref: sha, repoPath: this.repoPath });
			if (avatarUrlOrPromise instanceof Promise) {
				promises.push(
					avatarUrlOrPromise.then(uri => {
						authors.set(author.author, { ...author, avatarUrl: uri.toString(true) });
					}),
				);
				continue;
			}

			authors.set(author.author, { ...author, avatarUrl: avatarUrlOrPromise.toString(true) });
			hasUpdates = true;
		}

		if (hasUpdates || promises.length) {
			await Promise.allSettled(promises);
			this.notifyDidChangeAvatars();
		}
	}

	/** Fetches commit data for the requested SHAs and sends enriched commit data to webview */
	private async onGetMissingCommits(params: GetMissingCommitsParams): Promise<void> {
		if (!params.shas.length || !this.repoPath) return;

		const { commits, authors } = await this.getAndUpdateCommits(params.shas);
		if (commits.size) {
			this.notifyDidChangeCommits(commits, authors);
		}
	}

	private async getAndUpdateCommits(
		shas: string[],
	): Promise<{ commits: Map<string, GitCommit>; authors: Map<string, Author> }> {
		if (!shas.length || !this.repoPath) return { commits: new Map(), authors: new Map() };

		const requestedCommits = new Map<string, GitCommit>();
		const requestedAuthors = new Map<string, Author>();

		const { authors, commits } = this._enrichment;

		const shasRequested = new Set(shas);
		const shasToLoad = new Set(shasRequested);
		for (const sha of shasToLoad) {
			const commit = commits.get(sha);
			if (commit == null) continue;

			shasToLoad.delete(sha);
			requestedCommits.set(sha, commit);
		}

		const results = shasToLoad.size ? await this.getCommitsByShas(shasToLoad) : [];
		for (const commit of concat(requestedCommits.values(), results)) {
			const requestedSha = find(shasRequested, s => commit.sha.startsWith(s));
			if (requestedSha == null) {
				debugger;
				continue;
			}

			commits.set(requestedSha, commit);
			requestedCommits.set(requestedSha, commit);
			if (requestedSha === this._enrichment.onto?.sha) {
				this._enrichment.onto.commit = commit;
			}

			const authorName = commit.author.name;
			let author = authors.get(authorName);
			if (author == null) {
				author = {
					author: authorName,
					email: commit.author.email ?? '',
					avatarUrl: undefined,
					avatarFallbackUrl: getAvatarUriFromGravatarEmail(commit.author.email ?? '', 16).toString(true),
				};
				authors.set(authorName, author);
			}
			requestedAuthors.set(authorName, author);

			const committerName = commit.committer.name;
			if (committerName === authorName) continue;

			let committer = authors.get(committerName);
			if (committer == null) {
				committer = {
					author: committerName,
					email: commit.committer.email ?? '',
					avatarUrl: undefined,
					avatarFallbackUrl: getAvatarUriFromGravatarEmail(commit.committer.email ?? '', 16).toString(true),
				};
				authors.set(committerName, committer);
			}
			requestedAuthors.set(committerName, committer);
		}

		return { commits: requestedCommits, authors: requestedAuthors };
	}

	/** Handles request for potential rebase conflicts (Pro feature) */
	private async onGetPotentialConflicts(
		requestType: typeof GetPotentialConflictsRequest,
		msg: IpcMessage<GetPotentialConflictsParams>,
	): Promise<void> {
		const { branch, onto } = msg.params;

		// Check subscription status
		const subscription = await this.container.subscription.getSubscription();
		if (!isSubscriptionTrialOrPaidFromState(subscription?.state)) {
			await this.host.respond(requestType, msg, { conflicts: undefined });
			return;
		}

		const svc = this.container.git.getRepositoryService(this.repoPath);

		// For rebase: swap parameters because git merge-tree simulates merging branch into onto
		// (rebasing branch onto target means applying branch's commits on top of target)
		// Note: When rebasing a branch onto itself (e.g., git rebase -i HEAD~5), git merge-tree
		// will correctly detect this as a fast-forward with no conflicts.
		const conflicts = await svc.branches.getPotentialMergeOrRebaseConflict?.(onto, branch);

		await this.host.respond(requestType, msg, { conflicts: conflicts });
	}

	private async onRevealRef(params: RevealRefParams): Promise<void> {
		const revealIn = configuration.get('rebaseEditor.revealLocation');

		// For branches, always use the graph since commit details doesn't support branches
		if (params.type === 'branch') {
			const ref = createReference(params.ref, this.repoPath, {
				refType: 'branch',
				name: params.ref,
				remote: false,
			});
			await executeCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', {
				ref: ref,
				preserveFocus: true,
				viewColumn: ViewColumn.Beside,
			});
			return;
		}

		const ref = createReference(params.ref, this.repoPath, { refType: 'revision' });
		if (revealIn === 'graph') {
			await executeCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', {
				ref: ref,
				preserveFocus: true,
				viewColumn: ViewColumn.Beside,
			});
		} else {
			await this.container.views.commitDetails.show({ preserveFocus: true }, { commit: ref });
		}
	}

	private fireSelectionChangedDebounced?: Deferrable<RebaseWebviewProvider['fireSelectionChanged']>;
	private onSelectionChanged(params: UpdateSelectionParams): void {
		this.fireSelectionChangedDebounced ??= debounce(this.fireSelectionChanged.bind(this), 250);
		void this.fireSelectionChangedDebounced(params);
	}

	private getRevealBehavior() {
		const revealBehavior = configuration.get('rebaseEditor.revealBehavior');
		// Handle deprecated 'never' and 'onOpen' behavior
		if ((revealBehavior as string) === 'onOpen' || (revealBehavior as string) === 'never') {
			return 'onDoubleClick';
		}

		return revealBehavior;
	}

	private async fireSelectionChanged(params: UpdateSelectionParams): Promise<void> {
		const revealBehavior = this.getRevealBehavior();
		// Only auto-reveal on selection if behavior is 'onSelection'
		if (revealBehavior !== 'onSelection') return;

		const { processed } = this._todoDocument.parsed;
		const commits = processed.commits.values();
		const entry = find(commits, e => e.sha === params.sha);
		if (entry == null) return;

		let commit = this._enrichment?.commits.get(entry.sha);
		if (commit == null) {
			commit = await this.container.git.getRepositoryService(this.repoPath).commits.getCommit(entry.sha);
			if (commit == null) return;

			this._enrichment.commits.set(entry.sha, commit);
		}

		// Reveal in the preferred location
		const revealLocation = configuration.get('rebaseEditor.revealLocation');
		if (revealLocation === 'graph') {
			const ref = createReference(commit.sha, this.repoPath, { refType: 'revision' });
			await executeCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', {
				ref: ref,
				preserveFocus: true,
				viewColumn: ViewColumn.Beside,
			});
		} else {
			// Fire event for commit details view to pick up
			this.container.events.fire(
				'commit:selected',
				{ commit: commit, interaction: 'passive', preserveFocus: true, preserveVisibility: false },
				{ source: 'gitlens.rebase' },
			);
		}
	}

	private async parseState(): Promise<State> {
		const svc = this.container.git.getRepositoryService(this.repoPath);

		const { parsed, processed } = this._todoDocument.parsed;

		// Fetch branch, rebase status, and subscription
		const [branchResult, rebaseStatusResult, subscriptionResult] = await Promise.allSettled([
			this._branchName === undefined ? svc.branches.getBranch() : undefined,
			this.getRebaseStatus(svc),
			this.container.subscription.getSubscription(),
		]);

		if (this._branchName === undefined) {
			this._branchName = getSettledValue(branchResult)?.name ?? null;
		}

		const { status: rebaseStatus, doneEntries } = getSettledValue(rebaseStatusResult, {
			status: undefined,
			doneEntries: undefined,
		});

		const subscription = getSettledValue(subscriptionResult);

		// Get onto from parsed header or active rebase status
		const onto = parsed.info?.onto ?? rebaseStatus?.onto ?? '';
		this._enrichment.onto ??= { sha: onto };

		const { entries } = processed;
		const { authors, commits, onto: ontoCommit } = this._enrichment;

		const defaultDateFormat = configuration.get('defaultDateFormat');

		// Only enrich entries if we we have commits already
		if (commits.size) {
			this.enrichEntries(entries, commits, defaultDateFormat);
			if (doneEntries) {
				this.enrichEntries(doneEntries, commits, defaultDateFormat);
			}
		}

		return {
			webviewId: 'gitlens.rebase',
			webviewInstanceId: this.host.instanceId,
			timestamp: Date.now(),
			branch: this._branchName ?? '',
			onto: onto
				? {
						sha: ontoCommit.sha ?? onto,
						commit:
							ontoCommit?.commit != null
								? convertCommit(ontoCommit.commit, defaultDateFormat)
								: undefined,
					}
				: undefined,
			isInPlace: this.computeIsInPlace(processed),
			entries: entries,
			doneEntries: doneEntries,
			authors: authors != null ? Object.fromEntries(authors) : {},
			ascending: this.ascending,
			isReadOnly: processed.preservesMerges,
			revealLocation: configuration.get('rebaseEditor.revealLocation'),
			revealBehavior: this.getRevealBehavior(),
			rebaseStatus: rebaseStatus,
			repoPath: this.repoPath,
			subscription: subscription,
		};
	}

	/** Detects the reason the rebase is paused based on the last done entry's action */
	private detectPauseReason(lastAction: RebaseTodoAction | undefined): RebasePauseReason | undefined {
		switch (lastAction) {
			case 'edit':
				return 'edit';
			case 'reword':
				return 'reword';
			case 'break':
				return 'break';
			case 'exec':
				return 'exec';
			default:
				return undefined;
		}
	}

	/** Enriches entries with commit data */
	private enrichEntries(
		entries: RebaseEntry[],
		commits: Map<string, GitCommit>,
		defaultDateFormat: string | null,
	): void {
		for (const entry of entries) {
			if (entry.type !== 'commit' || entry.commit != null) continue;

			const commit = commits.get(entry.sha);
			if (commit == null) continue;

			entry.commit = convertCommit(commit, defaultDateFormat);
		}
	}

	private async getCommitsByShas(shas: Iterable<string>): Promise<Iterable<GitCommit>> {
		const query = join(
			map(shas, sha => `#:${sha}`),
			' ',
		);

		const result = await this.container.git
			.getRepositoryService(this.repoPath)
			.commits.searchCommits({ query: query }, { source: 'rebaseEditor' }, { limit: 0 });
		return result.log?.commits.values() ?? [];
	}

	/**
	 * Parses the 'done' file and transforms entries for display
	 * @returns processed entries for display and the last action for pause detection
	 */
	private async getDoneEntries(): Promise<{ entries: RebaseEntry[]; lastAction?: RebaseTodoAction }> {
		const parsed = await readAndParseRebaseDoneFile(this._todoDocument.uri);
		if (!parsed?.entries.length) return { entries: [] };

		const lastAction = parsed.entries.at(-1)?.action;
		const processed = processRebaseEntries(parsed.entries, true);

		return { entries: processed.entries, lastAction: lastAction };
	}

	/** Gets the active rebase status and done entries separately */
	private async getRebaseStatus(svc: ReturnType<Container['git']['getRepositoryService']>): Promise<{
		status: (RebaseActiveStatus & { onto: string }) | undefined;
		doneEntries: RebaseEntry[] | undefined;
	}> {
		// Get paused operation status to check if we're in an active rebase
		const pausedStatus = await svc.pausedOps?.getPausedOperationStatus?.();
		if (pausedStatus?.type !== 'rebase' || !pausedStatus.hasStarted) {
			return { status: undefined, doneEntries: undefined };
		}

		const { entries, lastAction } = await this.getDoneEntries();
		if (!entries.length) return { status: undefined, doneEntries: undefined };

		const hasConflicts = await svc.status.hasConflictingFiles();

		// Determine pause reason based on last done entry and conflict status
		const pauseReason: RebasePauseReason | undefined = hasConflicts
			? 'conflict'
			: this.detectPauseReason(lastAction);

		return {
			status: {
				currentStep: pausedStatus.steps.current.number,
				totalSteps: pausedStatus.steps.total,
				currentCommit: pausedStatus.steps.current.commit?.ref,
				hasConflicts: hasConflicts,
				pauseReason: pauseReason,
				onto: pausedStatus.onto.ref,
			},
			doneEntries: entries,
		};
	}

	private notifyDidChangeAvatars(): void {
		if (!this._enrichment?.authors.size || !this.host.visible) return;

		const avatars = Object.fromEntries(
			filterMap(this._enrichment.authors, ([k, v]) => (v.avatarUrl ? [k, v.avatarUrl] : undefined)),
		);

		void this.host.notify(DidChangeAvatarsNotification, { avatars: avatars });
	}

	private notifyDidChangeCommits(commits: Map<string, GitCommit>, authors: Map<string, Author>): void {
		if (!this.host.visible) return;

		const defaultDateFormat = configuration.get('defaultDateFormat');

		void this.host.notify(DidChangeCommitsNotification, {
			commits: Object.fromEntries(map(commits, ([k, v]) => [k, convertCommit(v, defaultDateFormat)])),
			authors: Object.fromEntries(authors),
			isInPlace: this.computeIsInPlace(),
		});
	}

	private async notifyDidChangeState(): Promise<void> {
		if (!this.host.visible) return;

		const state = await this.parseState();

		// Close the editor if rebase is complete (no entries, no done entries, and no active rebase)
		if (!state.entries.length && !state.doneEntries?.length && state.rebaseStatus == null) {
			this._closing = true;
			await closeTab(this._todoDocument.uri);
			return;
		}

		void this.host.notify(DidChangeNotification, { state: state });
	}

	private notifyDidChangeStateDebounced?: Deferrable<RebaseWebviewProvider['notifyDidChangeState']>;
	private updateState(immediate: boolean = false): void {
		if (immediate) {
			this.notifyDidChangeStateDebounced?.cancel();
			void this.notifyDidChangeState();
			return;
		}

		this.notifyDidChangeStateDebounced ??= debounce(this.notifyDidChangeState.bind(this), 250);
		void this.notifyDidChangeStateDebounced();
	}

	private async onEntryChanged(params: ChangeEntryParams): Promise<void> {
		return this.onEntriesChanged({ entries: [params] });
	}

	private async onEntriesChanged(params: ChangeEntriesParams): Promise<void> {
		if (!params.entries.length) return;

		await this._todoDocument.changeActions(params.entries);
	}

	private async onEntryMoved(params: MoveEntryParams): Promise<void> {
		const { entries } = this._todoDocument.parsed.processed;

		const index = entries.findIndex(e => e.id === params.id);
		if (index === -1) return;

		const entry = entries[index];

		// Calculate target index
		const targetIndex = this._todoDocument.calculateMoveTargetIndex(params, index, entries.length);
		if (targetIndex == null) return;

		// Handle "drop at end" case (targetIndex >= entries.length)
		const isDropAtEnd = targetIndex >= entries.length;
		const effectiveTargetIndex = isDropAtEnd ? entries.length - 1 : targetIndex;

		// Check if move would leave squash/fixup as oldest commit entry
		const needsSquashFix = this._todoDocument.wouldLeaveSquashAsOldest(entries, index, effectiveTargetIndex);

		// Apply the move edit first
		const targetEntry = entries[effectiveTargetIndex];
		await this._todoDocument.moveEntry(entry, targetEntry, isDropAtEnd, params.relative);

		// Fix squash/fixup as oldest commit entry AFTER move (re-read file for correct line numbers)
		if (needsSquashFix) {
			const processed = this._todoDocument.parsed.processed;
			const oldestCommit = first(processed.commits.values());
			if (oldestCommit) {
				await this._todoDocument.ensureValidOldestAction(oldestCommit);
			}
		}
	}

	private async onEntriesMoved(params: MoveEntriesParams): Promise<void> {
		if (!params.ids.length) return;

		const { entries } = this._todoDocument.parsed.processed;
		const ids = new Set(params.ids);

		// Get selected entries in their current order
		const selectedEntries = entries.filter(e => ids.has(e.id));
		if (!selectedEntries.length) return;

		// Remove selected entries and build new order
		const remainingEntries = entries.filter(e => !ids.has(e.id));

		// Clamp target index to valid range
		const targetIndex = Math.max(0, Math.min(params.to, remainingEntries.length));

		// Insert selected entries at target position
		const newEntries = [
			...remainingEntries.slice(0, targetIndex),
			...selectedEntries,
			...remainingEntries.slice(targetIndex),
		];

		// Check if oldest commit would be squash/fixup
		const oldestCommit = newEntries.find(e => e.type === 'commit');
		const needsOldestFix = oldestCommit && (oldestCommit.action === 'squash' || oldestCommit.action === 'fixup');

		// Rewrite all entry lines in the new order
		await this._todoDocument.reorderEntries(newEntries, needsOldestFix ? oldestCommit : undefined);
	}

	/**
	 * Shifts entries up or down independently, preserving gaps between non-contiguous selections
	 * Each selected entry swaps with the adjacent non-selected entry in the shift direction
	 */
	private async onEntriesShifted(params: ShiftEntriesParams): Promise<void> {
		if (!params.ids.length) return;

		const { entries } = this._todoDocument.parsed.processed;
		const ids = new Set(params.ids);

		// Get indices of selected entries
		const selectedIndices = entries.map((e, i) => (ids.has(e.id) ? i : -1)).filter(i => i !== -1);
		if (!selectedIndices.length) return;

		// Create a mutable copy of entries
		const newEntries = [...entries];

		if (params.direction === 'up') {
			// Process from top to bottom to avoid conflicts
			for (const idx of selectedIndices) {
				if (idx === 0) continue; // Can't move up from top

				const aboveIdx = idx - 1;
				// Only swap if the entry above is not selected
				if (!ids.has(newEntries[aboveIdx].id)) {
					[newEntries[aboveIdx], newEntries[idx]] = [newEntries[idx], newEntries[aboveIdx]];
				}
			}
		} else {
			// Process from bottom to top to avoid conflicts
			for (let i = selectedIndices.length - 1; i >= 0; i--) {
				const idx = selectedIndices[i];
				if (idx === entries.length - 1) continue; // Can't move down from bottom

				const belowIdx = idx + 1;
				// Only swap if the entry below is not selected
				if (!ids.has(newEntries[belowIdx].id)) {
					[newEntries[belowIdx], newEntries[idx]] = [newEntries[idx], newEntries[belowIdx]];
				}
			}
		}

		// Check if oldest commit would be squash/fixup
		const oldestCommit = newEntries.find(e => e.type === 'commit');
		const needsOldestFix = oldestCommit && (oldestCommit.action === 'squash' || oldestCommit.action === 'fixup');

		// Rewrite entries in new order
		await this._todoDocument.reorderEntries(newEntries, needsOldestFix ? oldestCommit : undefined);
	}
}

function convertCommit(commit: GitCommit, defaultDateFormat: string | null): Commit {
	return {
		sha: commit.sha,
		author: commit.author.name,
		committer: commit.committer.name,
		date: commit.formatDate(defaultDateFormat),
		formattedDate: commit.formattedDate,
		message: emojify(commit.message ?? commit.summary),
	};
}
