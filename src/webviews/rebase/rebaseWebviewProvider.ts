import type { Disposable, TextDocument } from 'vscode';
import { Position, Range, workspace, WorkspaceEdit } from 'vscode';
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
import type {
	ParsedRebaseTodo,
	ProcessedRebaseCommitEntry,
	ProcessedRebaseEntry,
	ProcessedRebaseTodo,
	RebaseTodoAction,
} from '../../git/models/rebase';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../git/models/repository';
import { parseRebaseTodo } from '../../git/parsers/rebaseTodoParser';
import {
	formatRebaseTodoEntryLine,
	processRebaseEntries,
	readAndParseRebaseDoneFile,
} from '../../git/utils/-webview/rebase.parsing.utils';
import { reopenRebaseTodoEditor } from '../../git/utils/-webview/rebase.utils';
import { createReference } from '../../git/utils/reference.utils';
import { executeCommand, executeCoreCommand } from '../../system/-webview/command';
import { configuration } from '../../system/-webview/configuration';
import { closeTab } from '../../system/-webview/vscode/tabs';
import type { Deferrable } from '../../system/function/debounce';
import { debounce } from '../../system/function/debounce';
import { filterMap, find, first, join, map } from '../../system/iterable';
import type { ComposerWebviewShowingArgs } from '../plus/composer/registration';
import type { ShowInCommitGraphCommandArgs } from '../plus/graph/registration';
import type { IpcMessage } from '../protocol';
import type { WebviewHost } from '../webviewProvider';
import type { WebviewPanelShowCommandArgs, WebviewShowOptions } from '../webviewsController';
import type {
	Author,
	ChangeEntriesParams,
	ChangeEntryParams,
	GetMissingAvatarsParams,
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
	DidChangeNotification,
	GetMissingAvatarsCommand,
	MoveEntriesCommand,
	MoveEntryCommand,
	RecomposeCommitsCommand,
	ReorderCommand,
	RevealRefCommand,
	SearchCommand,
	ShiftEntriesCommand,
	SkipCommand,
	StartCommand,
	SwitchCommand,
	UpdateSelectionCommand,
} from './protocol';

const maxSmallIntegerV8 = 2 ** 30 - 1;

interface CommitsResult {
	commits: GitCommit[];
	authors: Map<string, Author>;
	onto: GitCommit | undefined;
	from: GitCommit | undefined;
}

export class RebaseWebviewProvider implements Disposable {
	private readonly _disposables: Disposable[] = [];
	private _closing: boolean = false;

	// State
	private branchName?: string | null;
	private commitsResult?: CommitsResult;

	/** Cached parsed/processed todo file, invalidated when document version changes */
	private _parsedCache?: {
		version: number;
		parsed: ParsedRebaseTodo;
		processed: ProcessedRebaseTodo;
	};

	private get ascending() {
		return configuration.get('rebaseEditor.ordering') === 'asc';
	}

	/** Gets parsed and processed todo entries, using cache if document hasn't changed */
	private getParsedTodo(): { parsed: ParsedRebaseTodo; processed: ProcessedRebaseTodo } {
		if (this._parsedCache?.version === this.document.version) return this._parsedCache;

		const parsed = parseRebaseTodo(this.document.getText());
		const processed = processRebaseEntries(parsed.entries);
		this._parsedCache = { version: this.document.version, parsed: parsed, processed: processed };
		return this._parsedCache;
	}

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.rebase'>,
		private readonly document: TextDocument,
		private readonly repoPath: string,
	) {
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
		);

		// Subscribe to repository changes
		const repo = this.container.git.getRepository(this.repoPath);
		if (repo != null) {
			this._disposables.push(
				repo.onDidChange(e => {
					if (e.changed(RepositoryChange.Rebase, RepositoryChangeComparisonMode.Any)) {
						this.updateState();
					}
				}),
			);
		}
	}

	dispose(): void {
		this._disposables.forEach(d => void d.dispose());
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

	onShowing(loading: boolean, _options: WebviewShowOptions): [boolean, undefined] {
		// Reveal branch tip on initial load if behavior is 'onOpen'
		if (loading) {
			void this.revealBranchTipOnOpen();
		}
		return [true, undefined];
	}

	getTelemetryContext(): RebaseEditorTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
			'context.ascending': this.ascending,
		};
	}

	onRefresh(_force?: boolean): void {
		this.updateState(true);
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

			case RecomposeCommitsCommand.is(e):
				void this.onRecomposeCommits();
				break;
		}
	}

	onVisibilityChanged(visible: boolean): void {
		if (visible) {
			// If there was a pending change while hidden, update now
			this.updateState();
		}
	}

	private async revealBranchTipOnOpen(): Promise<void> {
		const revealBehavior = configuration.get('rebaseEditor.revealBehavior');
		if (revealBehavior !== 'onOpen') return;

		const revealLocation = configuration.get('rebaseEditor.revealLocation');
		const branchName =
			this.branchName ??
			(await this.container.git.getRepositoryService(this.repoPath).branches.getBranch())?.name;
		if (branchName == null) return;

		const ref = createReference(branchName, this.repoPath, {
			refType: 'branch',
			name: branchName,
			remote: false,
		});

		if (revealLocation === 'graph') {
			await executeCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', { ref: ref });
		} else {
			// For inspect view, get the branch tip commit
			const branch = await this.container.git.getRepositoryService(this.repoPath).branches.getBranch(branchName);
			if (branch?.sha != null) {
				const commit = await this.container.git
					.getRepositoryService(this.repoPath)
					.commits.getCommit(branch.sha);
				if (commit != null) {
					await this.container.views.commitDetails.show({ preserveFocus: true }, { commit: commit });
				}
			}
		}
	}

	private async parseState(): Promise<State> {
		const svc = this.container.git.getRepositoryService(this.repoPath);

		if (this.branchName === undefined) {
			const branch = await svc.branches.getBranch();
			this.branchName = branch?.name ?? null;
		}

		const { parsed, processed } = this.getParsedTodo();

		// Get active rebase status and done entries separately
		const { status: rebaseStatus, doneEntries } = await this.getRebaseStatus(svc);

		// Get onto and source from parsed header or active rebase status
		let onto = parsed.info?.onto ?? rebaseStatus?.onto ?? '';
		const from = parsed.info?.from ?? rebaseStatus?.source ?? '';

		let commitsResult: CommitsResult;
		if (this.commitsResult == null) {
			const shas = new Set<string>([
				...map(processed.commits.values(), e => e.sha),
				...filterMap(doneEntries ?? [], e => (e.type === 'commit' ? e.sha : undefined)),
			]);
			commitsResult = await this.getCommits(onto, from, shas);
			this.commitsResult = commitsResult;
		} else {
			commitsResult = this.commitsResult;
		}

		const { commits, authors, onto: ontoCommit, from: fromCommit } = commitsResult;

		const defaultDateFormat = configuration.get('defaultDateFormat');

		// Build entries array from flat processed list (already in file order)
		const entries: RebaseEntry[] = processed.entries.map(parsedEntry => {
			if (parsedEntry.type === 'commit') {
				return {
					type: 'commit' as const,
					id: parsedEntry.id,
					line: parsedEntry.line,
					action: parsedEntry.action,
					sha: parsedEntry.sha,
					message: parsedEntry.message,
					updateRefs: parsedEntry.updateRefs,
				};
			}
			return {
				type: 'command' as const,
				id: parsedEntry.id,
				line: parsedEntry.line,
				action: parsedEntry.action,
				command: parsedEntry.command,
			};
		});

		// Enrich all entries with commit data (mutates in place)
		this.enrichEntries(entries, commits, defaultDateFormat);
		if (doneEntries) {
			this.enrichEntries(doneEntries, commits, defaultDateFormat);
		}

		// If the onto commit is contained in the list of commits, remove it and clear the 'onto' value — See #1201
		// Don't do this during an active rebase since done entries are handled separately
		if (
			ontoCommit != null &&
			// Don't use commits, as we include the onto commit in that set
			entries.some(e => e.type === 'commit' && ontoCommit.sha.startsWith(e.sha)) &&
			rebaseStatus == null
		) {
			onto = '';
		}

		return {
			webviewId: 'gitlens.rebase',
			webviewInstanceId: this.host.instanceId,
			timestamp: Date.now(),
			branch: this.branchName ?? '',
			onto: onto
				? {
						sha: onto,
						commit:
							ontoCommit != null
								? {
										sha: ontoCommit.sha,
										author: ontoCommit.author.name,
										committer: ontoCommit.committer.name,
										date: ontoCommit.formatDate(defaultDateFormat),
										dateFromNow: ontoCommit.formatDateFromNow(),
										message: emojify(ontoCommit.message || 'root'),
									}
								: undefined,
					}
				: undefined,
			source: from
				? {
						sha: from,
						commit:
							fromCommit != null
								? {
										sha: fromCommit.sha,
										author: fromCommit.author.name,
										committer: fromCommit.committer.name,
										date: fromCommit.formatDate(defaultDateFormat),
										dateFromNow: fromCommit.formatDateFromNow(),
										message: emojify(fromCommit.message || 'root'),
									}
								: undefined,
					}
				: undefined,
			entries: entries,
			doneEntries: doneEntries,
			authors: authors != null ? Object.fromEntries(authors) : {},
			ascending: this.ascending,
			isReadOnly: processed.preservesMerges,
			revealLocation: configuration.get('rebaseEditor.revealLocation'),
			revealBehavior: configuration.get('rebaseEditor.revealBehavior'),
			rebaseStatus: rebaseStatus,
			repoPath: this.repoPath,
		};
	}

	/** Gets the active rebase status and done entries separately */
	private async getRebaseStatus(svc: ReturnType<Container['git']['getRepositoryService']>): Promise<{
		status: (RebaseActiveStatus & { onto: string; source: string }) | undefined;
		doneEntries: RebaseEntry[] | undefined;
	}> {
		// Get paused operation status to check if we're in an active rebase
		const pausedStatus = await svc.pausedOps?.getPausedOperationStatus?.();
		if (pausedStatus?.type !== 'rebase' || (pausedStatus.steps?.current.number ?? 0) === 0) {
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
				source: pausedStatus.source.ref,
			},
			doneEntries: entries,
		};
	}

	/**
	 * Parses the 'done' file and transforms entries for display
	 * Returns processed entries for display and the last action for pause detection
	 */
	private async getDoneEntries(): Promise<{ entries: RebaseEntry[]; lastAction?: RebaseTodoAction }> {
		const parsed = await readAndParseRebaseDoneFile(this.document.uri);
		if (!parsed?.entries.length) return { entries: [] };

		const lastAction = parsed.entries.at(-1)?.action;
		const processed = processRebaseEntries(parsed.entries);

		let lineIndex = -1;
		const entries: RebaseEntry[] = processed.entries.map(entry => {
			if (entry.type === 'commit') {
				return {
					type: entry.type,
					id: entry.id,
					action: entry.action,
					sha: entry.sha,
					message: entry.message,
					line: lineIndex--,
					updateRefs: entry.updateRefs,
				};
			}
			return {
				type: entry.type,
				id: entry.id,
				action: entry.action,
				command: entry.command,
				line: lineIndex--,
			};
		});

		return { entries: entries, lastAction: lastAction };
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

	/** Enriches entries with full commit data (mutates in place) */
	private enrichEntries(entries: RebaseEntry[], commits: GitCommit[], defaultDateFormat: string | null): void {
		for (const entry of entries) {
			if (entry.type !== 'commit') continue;

			const commit = commits.find(c => c.sha.startsWith(entry.sha));
			if (commit != null) {
				entry.commit = {
					sha: commit.sha,
					author: commit.author.name,
					committer: commit.committer.name,
					date: commit.formatDate(defaultDateFormat),
					dateFromNow: commit.formattedDate,
					message: emojify(commit.message ?? commit.summary),
				};
			}
		}
	}

	private async getCommits(onto: string, from: string, shas: Iterable<string>): Promise<CommitsResult> {
		const commits = [];
		const authors = new Map<string, Author>();
		let ontoCommit: GitCommit | undefined;
		let fromCommit: GitCommit | undefined;

		const result = await this.container.git.getRepositoryService(this.repoPath).commits.searchCommits(
			{
				query: `${onto ? `#:${onto} ` : ''}${from ? `#:${from} ` : ''}${join(
					map(shas, sha => `#:${sha}`),
					' ',
				)}`,
			},
			{ source: 'rebaseEditor' },
			{ limit: 0 },
		);

		if (result.log != null) {
			for (const c of result.log.commits.values()) {
				commits.push(c);
				if (onto && c.sha.startsWith(onto)) {
					ontoCommit = c;
				}
				if (from && c.sha.startsWith(from)) {
					fromCommit = c;
				}

				if (!authors.has(c.author.name)) {
					authors.set(c.author.name, {
						author: c.author.name,
						avatarUrl: undefined,
						avatarFallbackUrl: c.author.email
							? getAvatarUriFromGravatarEmail(c.author.email, 32).toString(true)
							: undefined,
						email: c.author.email,
					});
				}
				if (!authors.has(c.committer.name)) {
					authors.set(c.committer.name, {
						author: c.committer.name,
						avatarUrl: undefined,
						avatarFallbackUrl: c.committer.email
							? getAvatarUriFromGravatarEmail(c.committer.email, 32).toString(true)
							: undefined,
						email: c.committer.email,
					});
				}
			}
		}

		return { commits: commits, authors: authors, onto: ontoCommit, from: fromCommit };
	}

	/** Fetches enhanced avatars (from GitHub/GitLab/etc.) for the requested emails */
	private async onGetMissingAvatars(params: GetMissingAvatarsParams): Promise<void> {
		if (!this.commitsResult?.authors.size || !this.repoPath) return;

		const { authors } = this.commitsResult;

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

	private notifyDidChangeAvatars(): void {
		if (!this.commitsResult?.authors.size || !this.host.visible) return;

		const avatars: Record<string, string> = {};
		for (const [name, author] of this.commitsResult.authors) {
			if (!author.avatarUrl) continue;

			avatars[name] = author.avatarUrl;
		}

		void this.host.notify(DidChangeAvatarsNotification, { avatars: avatars });
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

	private async notifyDidChangeState(): Promise<void> {
		if (!this.host.visible) return;

		const state = await this.parseState();

		// Close the editor if rebase is complete (no entries and no active rebase)
		if (!state.entries.length && state.rebaseStatus == null) {
			this._closing = true;
			await closeTab(this.document.uri);
			return;
		}

		void this.host.notify(DidChangeNotification, { state: state });
	}

	private async onAbort(): Promise<void> {
		this._closing = true;

		// Delete the contents to abort the rebase
		const edit = new WorkspaceEdit();
		edit.delete(this.document.uri, new Range(0, 0, this.document.lineCount, 0));
		await workspace.applyEdit(edit);
		await this.document.save();

		const svc = this.container.git.getRepositoryService(this.repoPath);
		await abortPausedOperation(svc);
		await closeTab(this.document.uri);
	}

	private async onRecomposeCommits(): Promise<void> {
		// Get commit SHAs from the rebase entries
		const { processed } = this.getParsedTodo();
		const commitShas = [...processed.commits.values()].map(e => e.sha);

		// Open the Commit Composer with the commits
		void executeCommand<WebviewPanelShowCommandArgs<ComposerWebviewShowingArgs>>(
			'gitlens.showComposerPage',
			undefined,
			{
				repoPath: this.repoPath,
				source: 'rebaseEditor',
				mode: 'preview',
				branchName: this.branchName ?? undefined,
				commitShas: commitShas,
			},
		);

		await this.onAbort();
	}

	private async onContinue(): Promise<void> {
		// Save the document first to ensure any changes are persisted
		await this.document.save();

		const svc = this.container.git.getRepositoryService(this.repoPath);
		await continuePausedOperation(svc);
	}

	private async onSkip(): Promise<void> {
		const svc = this.container.git.getRepositoryService(this.repoPath);
		await skipPausedOperation(svc);
	}

	private async onStart(): Promise<void> {
		this._closing = true;

		await this.document.save();
		await closeTab(this.document.uri);
	}

	private async onSwapOrdering(params: ReorderParams): Promise<void> {
		await configuration.updateEffective('rebaseEditor.ordering', (params.ascending ?? false) ? 'asc' : 'desc');
		this.updateState(true);
	}

	private onSwitchToText(): Promise<void> {
		return reopenRebaseTodoEditor('default');
	}

	private async onEntryChanged(params: ChangeEntryParams): Promise<void> {
		return this.onEntriesChanged({ entries: [params] });
	}

	private async onEntriesChanged(params: ChangeEntriesParams): Promise<void> {
		if (!params.entries.length) return;

		const { processed } = this.getParsedTodo();
		const edit = new WorkspaceEdit();

		// Build a map of sha -> requested action for quick lookup
		const requestedActions = new Map(params.entries.map(e => [e.sha, e.action]));

		// Simulate the new entries state to check constraints
		const newEntries = map(processed.commits.values(), e => {
			const requestedAction = requestedActions.get(e.sha);
			return requestedAction != null ? { ...e, action: requestedAction } : e;
		});

		// Check if oldest entry would become squash/fixup (invalid)
		const [oldestEntry] = newEntries;
		const oldestNeedsReset = oldestEntry.action === 'squash' || oldestEntry.action === 'fixup';

		for (const { sha, action: requestedAction } of params.entries) {
			const entry = processed.commits.get(sha);
			if (entry == null) continue;

			// Determine final action
			let action = requestedAction;
			if (oldestNeedsReset && sha === oldestEntry.sha) {
				// User tried to set first entry to squash/fixup - reset to pick
				action = 'pick';
			}

			const range = this.document.validateRange(
				new Range(new Position(entry.line, 0), new Position(entry.line, maxSmallIntegerV8)),
			);

			// Preserve flag (e.g., fixup -c, fixup -C) if present
			const flagPart = entry.flag ? ` ${entry.flag}` : '';
			edit.replace(this.document.uri, range, `${action}${flagPart} ${entry.sha} ${entry.message}`);
		}

		// If oldest entry needs reset and wasn't in the batch, reset it
		if (oldestNeedsReset && !requestedActions.has(oldestEntry.sha)) {
			const originalOldest = processed.commits.get(oldestEntry.sha);
			if (originalOldest != null) {
				const range = this.document.validateRange(
					new Range(
						new Position(originalOldest.line, 0),
						new Position(originalOldest.line, maxSmallIntegerV8),
					),
				);
				const flagPart = originalOldest.flag ? ` ${originalOldest.flag}` : '';
				edit.replace(
					this.document.uri,
					range,
					`pick${flagPart} ${originalOldest.sha} ${originalOldest.message}`,
				);
			}
		}

		await workspace.applyEdit(edit);
	}

	private async onEntryMoved(params: MoveEntryParams): Promise<void> {
		const { entries } = this.getParsedTodo().processed;

		const index = entries.findIndex(e => e.id === params.id);
		if (index === -1) return;

		const entry = entries[index];

		// Calculate target index
		const targetIndex = this.calculateMoveTargetIndex(params, index, entries.length);
		if (targetIndex == null) return;

		// Handle "drop at end" case (targetIndex >= entries.length)
		const isDropAtEnd = targetIndex >= entries.length;
		const effectiveTargetIndex = isDropAtEnd ? entries.length - 1 : targetIndex;

		// Check if move would leave squash/fixup as oldest commit entry
		const needsSquashFix = this.wouldLeaveSquashAsOldest(entries, index, effectiveTargetIndex);

		// Apply the move edit first
		const targetEntry = entries[effectiveTargetIndex];
		await this.applyMoveEdit(entry, targetEntry, isDropAtEnd, params.relative);

		// Fix squash/fixup as oldest commit entry AFTER move (re-read file for correct line numbers)
		if (needsSquashFix) {
			await this.fixOldestCommitIfSquash();
		}
	}

	private async onEntriesMoved(params: MoveEntriesParams): Promise<void> {
		if (!params.ids.length) return;

		const { entries } = this.getParsedTodo().processed;
		const ids = new Set(params.ids);

		// Get selected entries in their current order
		const selectedEntries = entries.filter(e => ids.has(e.id));
		if (selectedEntries.length === 0) return;

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
		await this.rewriteEntries(entries, newEntries, needsOldestFix ? oldestCommit : undefined);
	}

	/**
	 * Shifts entries up or down independently, preserving gaps between non-contiguous selections
	 * Each selected entry swaps with the adjacent non-selected entry in the shift direction
	 */
	private async onEntriesShifted(params: ShiftEntriesParams): Promise<void> {
		if (!params.ids.length) return;

		const { entries } = this.getParsedTodo().processed;
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
		await this.rewriteEntries(entries, newEntries, needsOldestFix ? oldestCommit : undefined);
	}

	/**
	 * Calculates the target index for a move operation
	 * @returns Target index, or null if the move is invalid/no-op
	 */
	private calculateMoveTargetIndex(params: MoveEntryParams, currentIndex: number, entryCount: number): number | null {
		if (params.relative) {
			// Relative move: +1 (down) or -1 (up)
			const targetIndex = currentIndex + params.to;
			// Boundary check
			if (targetIndex < 0 || targetIndex >= entryCount) return null;
			return targetIndex;
		}

		// Absolute move (drag)
		if (currentIndex === params.to) return null;
		return params.to;
	}

	/** Checks if the move would leave a squash/fixup as the oldest commit entry */
	private wouldLeaveSquashAsOldest(entries: ProcessedRebaseEntry[], fromIndex: number, toIndex: number): boolean {
		// Simulate the move
		const entry = entries[fromIndex];
		const newEntries = [...entries];
		newEntries.splice(fromIndex, 1);
		newEntries.splice(toIndex, 0, entry);

		// Find the oldest commit entry
		const oldestCommit = newEntries.find(e => e.type === 'commit');
		if (!oldestCommit) return false;

		return oldestCommit.action === 'squash' || oldestCommit.action === 'fixup';
	}

	/** Re-reads the file and fixes the oldest commit entry if it's squash/fixup */
	private async fixOldestCommitIfSquash(): Promise<void> {
		const processed = this.getParsedTodo().processed;
		// First commit in the todo file is the oldest
		const oldestCommit = first(processed.commits.values());
		if (!oldestCommit) return;

		if (oldestCommit.action !== 'squash' && oldestCommit.action !== 'fixup') return;

		const range = this.document.validateRange(
			new Range(new Position(oldestCommit.line, 0), new Position(oldestCommit.line, maxSmallIntegerV8)),
		);
		const edit = new WorkspaceEdit();
		edit.replace(this.document.uri, range, `pick ${oldestCommit.sha} ${oldestCommit.message}`);
		await workspace.applyEdit(edit);
	}

	/** Rewrites all entry lines in the new order */
	private async rewriteEntries(
		originalEntries: ProcessedRebaseEntry[],
		newEntries: ProcessedRebaseEntry[],
		fixOldestCommit?: ProcessedRebaseCommitEntry,
	): Promise<void> {
		const edit = new WorkspaceEdit();

		for (let i = 0; i < originalEntries.length; i++) {
			const original = originalEntries[i];
			const newEntry = newEntries[i];

			// Check if this entry changed position or needs action fix
			const needsUpdate = original.id !== newEntry.id || (fixOldestCommit && newEntry.id === fixOldestCommit.id);

			if (needsUpdate) {
				const range = this.document.validateRange(
					new Range(new Position(original.line, 0), new Position(original.line, maxSmallIntegerV8)),
				);
				// If this is the oldest commit that needs fixing, use 'pick'
				const overrideAction = fixOldestCommit && newEntry.id === fixOldestCommit.id ? 'pick' : undefined;
				edit.replace(this.document.uri, range, formatRebaseTodoEntryLine(newEntry, overrideAction));
			}
		}

		await workspace.applyEdit(edit);
	}

	/**
	 * Applies the file edit to move an entry
	 *
	 * VS Code's WorkspaceEdit uses ORIGINAL line numbers, so we must order
	 * operations carefully to avoid conflicts:
	 * - Moving DOWN: insert first (at higher line), then delete (at lower line)
	 * - Moving UP: delete first (at higher line), then insert (at lower line)
	 */
	private async applyMoveEdit(
		entry: ProcessedRebaseEntry,
		targetEntry: ProcessedRebaseEntry,
		isDropAtEnd: boolean,
		isRelativeMove: boolean,
	): Promise<void> {
		const edit = new WorkspaceEdit();

		// Build the line text to insert
		const insertText = `${formatRebaseTodoEntryLine(entry)}\n`;

		// Range to delete (the source entry's line)
		const deleteRange = this.document.validateRange(
			new Range(new Position(entry.line, 0), new Position(entry.line + 1, 0)),
		);

		const isMovingDown = entry.line < targetEntry.line;

		if (isMovingDown) {
			// Moving DOWN: insert first, then delete
			const insertLine = this.calculateDownwardInsertLine(targetEntry.line, isDropAtEnd, isRelativeMove);
			edit.insert(this.document.uri, new Position(insertLine, 0), insertText);
			edit.delete(this.document.uri, deleteRange);
		} else {
			// Moving UP: delete first, then insert
			edit.delete(this.document.uri, deleteRange);
			edit.insert(this.document.uri, new Position(targetEntry.line, 0), insertText);
		}

		await workspace.applyEdit(edit);
	}

	/**
	 * Calculates the insert line for downward moves
	 * - Drop at end: insert AFTER the last entry
	 * - Keyboard swap: insert AFTER target (swap positions)
	 * - Drag: insert AT target's position (take its spot)
	 */
	private calculateDownwardInsertLine(targetLine: number, isDropAtEnd: boolean, isRelativeMove: boolean): number {
		if (isDropAtEnd || isRelativeMove) {
			return targetLine + 1; // Insert after target
		}
		return targetLine; // Insert at target's position
	}

	private fireSelectionChangedDebounced?: Deferrable<RebaseWebviewProvider['fireSelectionChanged']>;
	private onSelectionChanged(params: UpdateSelectionParams): void {
		this.fireSelectionChangedDebounced ??= debounce(this.fireSelectionChanged.bind(this), 250);
		void this.fireSelectionChangedDebounced(params);
	}

	private async fireSelectionChanged(params: UpdateSelectionParams): Promise<void> {
		const revealBehavior = configuration.get('rebaseEditor.revealBehavior');
		// Only auto-reveal on selection if behavior is 'onSelection'
		if (revealBehavior !== 'onSelection') return;

		const { processed } = this.getParsedTodo();
		const commits = processed.commits.values();
		const entry = find(commits, e => e.sha === params.sha);
		if (entry == null) return;

		const commit = this.commitsResult?.commits.find(c => c.sha.startsWith(entry.sha));
		if (commit == null) return;

		// Reveal in the preferred location
		const revealLocation = configuration.get('rebaseEditor.revealLocation');
		if (revealLocation === 'graph') {
			const ref = createReference(commit.sha, this.repoPath, { refType: 'revision' });
			await executeCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', { ref: ref });
		} else {
			// Fire event for commit details view to pick up
			this.container.events.fire(
				'commit:selected',
				{ commit: commit, interaction: 'passive', preserveFocus: true, preserveVisibility: false },
				{ source: 'gitlens.rebase' },
			);
		}
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
			await executeCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', { ref: ref });
			return;
		}

		const ref = createReference(params.ref, this.repoPath, { refType: 'revision' });
		if (revealIn === 'graph') {
			await executeCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', { ref: ref });
		} else {
			await this.container.views.commitDetails.show({ preserveFocus: true }, { commit: ref });
		}
	}

	private async onShowConflicts(): Promise<void> {
		await showPausedOperationStatus(this.container, this.repoPath);
	}
}
