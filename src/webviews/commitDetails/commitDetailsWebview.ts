import { EntityIdentifierUtils } from '@gitkraken/provider-apis/entity-identifiers';
import type { ConfigurationChangeEvent, TextDocumentShowOptions } from 'vscode';
import { CancellationTokenSource, Disposable, env, Uri, window } from 'vscode';
import type { MaybeEnrichedAutolink } from '../../autolinks/models/autolinks.js';
import { serializeAutolink } from '../../autolinks/utils/-webview/autolinks.utils.js';
import { getAvatarUri } from '../../avatars.js';
import type { CopyDeepLinkCommandArgs, CopyFileDeepLinkCommandArgs } from '../../commands/copyDeepLink.js';
import type { CopyMessageToClipboardCommandArgs } from '../../commands/copyMessageToClipboard.js';
import type { CopyShaToClipboardCommandArgs } from '../../commands/copyShaToClipboard.js';
import type { DiffWithCommandArgs } from '../../commands/diffWith.js';
import type { ExplainCommitCommandArgs } from '../../commands/explainCommit.js';
import type { ExplainStashCommandArgs } from '../../commands/explainStash.js';
import type { ExplainWipCommandArgs } from '../../commands/explainWip.js';
import type { OpenFileOnRemoteCommandArgs } from '../../commands/openFileOnRemote.js';
import type { OpenOnRemoteCommandArgs } from '../../commands/openOnRemote.js';
import type { OpenPullRequestOnRemoteCommandArgs } from '../../commands/openPullRequestOnRemote.js';
import type { CreatePatchCommandArgs } from '../../commands/patches.js';
import type { GlWebviewCommandsOrCommandsWithSuffix } from '../../constants.commands.js';
import type { ContextKeys } from '../../constants.context.js';
import { isSupportedCloudIntegrationId } from '../../constants.integrations.js';
import type { InspectTelemetryContext, Sources } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import type { CommitSelectedEvent } from '../../eventBus.js';
import {
	applyChanges,
	openChanges,
	openChangesWithWorking,
	openComparisonChanges,
	openFile,
	openFileAtRevision,
	openFileOnRemote,
	restoreFile,
	showDetailsQuickPick,
} from '../../git/actions/commit.js';
import * as RepoActions from '../../git/actions/repository.js';
import { executeGitCommand } from '../../git/actions.js';
import { CheckoutError } from '../../git/errors.js';
import { CommitFormatter } from '../../git/formatters/commitFormatter.js';
import type { GitBranch } from '../../git/models/branch.js';
import type { GitCommit } from '../../git/models/commit.js';
import { isCommit, isStash } from '../../git/models/commit.js';
import type { GitFileChange, GitFileChangeShape } from '../../git/models/fileChange.js';
import type { IssueOrPullRequest } from '../../git/models/issueOrPullRequest.js';
import type { PullRequest } from '../../git/models/pullRequest.js';
import type { GitRevisionReference } from '../../git/models/reference.js';
import type { GitRemote } from '../../git/models/remote.js';
import { RemoteResourceType } from '../../git/models/remoteResource.js';
import type { Repository } from '../../git/models/repository.js';
import { uncommitted, uncommittedStaged } from '../../git/models/revision.js';
import type { CommitSignature } from '../../git/models/signature.js';
import type { RemoteProvider } from '../../git/remotes/remoteProvider.js';
import type { GitCommitSearchContext } from '../../git/search.js';
import { getReferenceFromRevision } from '../../git/utils/-webview/reference.utils.js';
import { splitCommitMessage } from '../../git/utils/commit.utils.js';
import { serializeIssueOrPullRequest } from '../../git/utils/issueOrPullRequest.utils.js';
import { getComparisonRefsForPullRequest, serializePullRequest } from '../../git/utils/pullRequest.utils.js';
import { createReference } from '../../git/utils/reference.utils.js';
import { isUncommitted, shortenRevision } from '../../git/utils/revision.utils.js';
import { areSearchContextsEqual } from '../../git/utils/search.utils.js';
import { showGitErrorMessage } from '../../messages.js';
import { showPatchesView } from '../../plus/drafts/actions.js';
import type { CreateDraftChange, Draft, DraftVisibility } from '../../plus/drafts/models/drafts.js';
import { confirmDraftStorage } from '../../plus/drafts/utils/-webview/drafts.utils.js';
import type { Subscription } from '../../plus/gk/models/subscription.js';
import type { SubscriptionChangeEvent } from '../../plus/gk/subscriptionService.js';
import { ensureAccount } from '../../plus/gk/utils/-webview/acount.utils.js';
import type { ConfiguredIntegrationsChangeEvent } from '../../plus/integrations/authentication/configuredIntegrationService.js';
import { supportsCodeSuggest } from '../../plus/integrations/providers/models.js';
import { getEntityIdentifierInput } from '../../plus/integrations/providers/utils.js';
import {
	executeCommand,
	executeCoreCommand,
	executeCoreGitCommand,
	registerWebviewCommand,
} from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import { getContext, onDidChangeContext, setContext } from '../../system/-webview/context.js';
import type { MergeEditorInputs } from '../../system/-webview/vscode/editors.js';
import { openMergeEditor } from '../../system/-webview/vscode/editors.js';
import { createCommandDecorator, getWebviewCommand } from '../../system/decorators/command.js';
import { debug, trace } from '../../system/decorators/log.js';
import type { Deferrable } from '../../system/function/debounce.js';
import { debounce } from '../../system/function/debounce.js';
import { filterMap, map } from '../../system/iterable.js';
import { getScopedLogger } from '../../system/logger.scope.js';
import { MRU } from '../../system/mru.js';
import { getSettledValue, pauseOnCancelOrTimeoutMapTuplePromise } from '../../system/promise.js';
import type { LinesChangeEvent } from '../../trackers/lineTracker.js';
import type { IpcParams, IpcResponse } from '../ipc/handlerRegistry.js';
import { ipcCommand, ipcRequest } from '../ipc/handlerRegistry.js';
import type { ShowInCommitGraphCommandArgs } from '../plus/graph/registration.js';
import type { Change } from '../plus/patchDetails/protocol.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../webviewProvider.js';
import type { WebviewShowOptions } from '../webviewsController.js';
import { isSerializedState } from '../webviewsController.js';
import {
	getFileCommitFromContext,
	getUriFromContext,
	isDetailsFileContext,
	isDetailsItemContext,
} from './commitDetailsWebview.utils.js';
import type {
	CommitDetails,
	CommitSignatureShape,
	DetailsItemContext,
	ExecuteFileActionParams,
	GitBranchShape,
	Mode,
	Preferences,
	ShowWipArgs,
	State,
	Wip,
	WipChange,
} from './protocol.js';
import {
	ChangeReviewModeCommand,
	CreatePatchFromWipCommand,
	DidChangeDraftStateNotification,
	DidChangeHasAccountNotification,
	DidChangeIntegrationsNotification,
	DidChangeNotification,
	DidChangeOrgSettingsNotification,
	DidChangeWipStateNotification,
	ExecuteCommitActionCommand,
	ExecuteFileActionCommand,
	ExplainRequest,
	FetchCommand,
	GenerateRequest,
	messageHeadlineSplitterToken,
	NavigateCommand,
	OpenFileCommand,
	OpenFileComparePreviousCommand,
	OpenFileCompareWorkingCommand,
	OpenFileOnRemoteCommand,
	OpenPullRequestChangesCommand,
	OpenPullRequestComparisonCommand,
	OpenPullRequestDetailsCommand,
	OpenPullRequestOnRemoteCommand,
	PickCommitCommand,
	PinCommand,
	PublishCommand,
	PullCommand,
	PushCommand,
	ReachabilityRequest,
	SearchCommitCommand,
	ShowCodeSuggestionCommand,
	StageFileCommand,
	SuggestChangesCommand,
	SwitchCommand,
	SwitchModeCommand,
	UnstageFileCommand,
	UpdatePreferencesCommand,
} from './protocol.js';
import type { CommitDetailsWebviewShowingArgs } from './registration.js';

const { command, getCommands } =
	createCommandDecorator<GlWebviewCommandsOrCommandsWithSuffix<'commitDetails' | 'graphDetails'>>();

type RepositorySubscription = { repo: Repository; subscription: Disposable };

// interface WipContext extends Wip
interface WipContext {
	changes: WipChange | undefined;
	repositoryCount: number;
	branch?: GitBranch;
	pullRequest?: PullRequest;
	repo: Repository;
	codeSuggestions?: Draft[];
}

/** Keeps commit and searchContext synchronized as a unit */
interface CommitState {
	commit: GitCommit | undefined;
	searchContext: GitCommitSearchContext | undefined;
}

interface Context {
	mode: Mode;
	navigationStack: {
		count: number;
		position: number;
		hint?: string;
	};
	pinned: boolean;
	preferences: Preferences;

	commitState: CommitState;
	autolinksEnabled: boolean;
	experimentalComposerEnabled: boolean;
	formattedMessage: string | undefined;
	autolinkedIssues: IssueOrPullRequest[] | undefined;
	pullRequest: PullRequest | undefined;
	wip: WipContext | undefined;
	inReview: boolean;
	orgSettings: State['orgSettings'];
	source?: Sources;
	hasAccount: boolean | undefined;
	hasIntegrationsConnected: boolean | undefined;
}

export class CommitDetailsWebviewProvider implements WebviewProvider<State, State, CommitDetailsWebviewShowingArgs> {
	/** The context the webview has */
	private _context: Context;
	private readonly _disposable: Disposable;
	private _pinned = false;
	private _focused = false;
	private _commitStack = new MRU<GitRevisionReference>(10, (a, b) => a.ref === b.ref);

	private get commit(): GitCommit | undefined {
		return this._context.commitState.commit;
	}

	private get searchContext(): GitCommitSearchContext | undefined {
		return this._context.commitState.searchContext;
	}

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.views.commitDetails' | 'gitlens.views.graphDetails'>,
		private readonly options: { attachedTo: 'default' | 'graph' },
	) {
		this._context = {
			mode: 'commit',
			inReview: false,
			navigationStack: {
				count: 0,
				position: 0,
			},
			pinned: false,
			preferences: this.getPreferences(),

			commitState: { commit: undefined, searchContext: undefined },
			autolinksEnabled: configuration.get('views.commitDetails.autolinks.enabled'),
			experimentalComposerEnabled: configuration.get('ai.experimental.composer.enabled', undefined, false),
			formattedMessage: undefined,
			autolinkedIssues: undefined,
			pullRequest: undefined,
			wip: undefined,
			orgSettings: this.getOrgSettings(),
			hasAccount: undefined,
			hasIntegrationsConnected: undefined,
		};

		this._disposable = Disposable.from(
			configuration.onDidChangeAny(this.onAnyConfigurationChanged, this),
			onDidChangeContext(this.onContextChanged, this),
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			container.integrations.onDidChange(this.onIntegrationsChanged, this),
		);
	}

	dispose(): void {
		this._disposable.dispose();
		this._lineTrackerDisposable?.dispose();
		this._repositorySubscription?.subscription.dispose();
		this._selectionTrackerDisposable?.dispose();
		this._wipSubscription?.subscription.dispose();
	}

	getTelemetrySource(): Sources {
		return this.options.attachedTo === 'graph' ? 'graph-details' : 'inspect';
	}

	getTelemetryContext(): InspectTelemetryContext {
		let context: InspectTelemetryContext;
		if (this.mode === 'wip') {
			const repo = this._context.wip?.repo;
			context = {
				...this.host.getTelemetryContext(),
				'context.attachedTo': this.options.attachedTo,
				'context.mode': this.mode,
				'context.autolinks': this._context.wip?.pullRequest != null ? 1 : 0,
				'context.inReview': this._context.inReview,
				'context.codeSuggestions': this._context.wip?.codeSuggestions?.length ?? 0,
				'context.repository.id': repo?.idHash,
				'context.repository.scheme': repo?.uri.scheme,
				'context.repository.closed': repo?.closed,
				'context.repository.folder.scheme': repo?.folder?.uri.scheme,
				'context.repository.provider.id': repo?.provider.id,
			};
		} else {
			context = {
				...this.host.getTelemetryContext(),
				'context.attachedTo': this.options.attachedTo,
				'context.mode': this.mode,
				'context.autolinks':
					(this._context.pullRequest != null ? 1 : 0) + (this._context.autolinkedIssues?.length ?? 0),
				'context.pinned': this._context.pinned,
				'context.type': this.commit == null ? undefined : isStash(this.commit) ? 'stash' : 'commit',
				'context.uncommitted': this.commit?.isUncommitted ?? false,
			};
		}

		return context;
	}

	private _skipNextRefreshOnVisibilityChange = false;
	private _shouldRefreshPullRequestDetails = false;

	async onShowing(
		_loading: boolean,
		options?: WebviewShowOptions,
		...args: WebviewShowingArgs<CommitDetailsWebviewShowingArgs, State>
	): Promise<[boolean, InspectTelemetryContext]> {
		const [arg] = args;
		if ((arg as ShowWipArgs)?.type === 'wip') {
			return [await this.onShowingWip(arg as ShowWipArgs), this.getTelemetryContext()];
		}

		return [
			await this.onShowingCommit(arg as Partial<CommitSelectedEvent['data']> | undefined, options),
			this.getTelemetryContext(),
		];
	}

	private get inReview(): boolean {
		return this._context.inReview;
	}

	async onShowingWip(arg: ShowWipArgs, options?: WebviewShowOptions): Promise<boolean> {
		this._context.source = arg.source;
		const shouldChangeReview = arg.inReview != null && this.inReview !== arg.inReview;
		if (this.mode !== 'wip' || (arg.repository != null && this._context.wip?.repo !== arg.repository)) {
			if (shouldChangeReview && arg.inReview != null) {
				this._context.inReview = arg.inReview;
			}
			await this.setMode('wip', arg.repository);
			if (shouldChangeReview && arg.inReview === true) {
				void this.trackOpenReviewMode(arg.source);
			}
		} else if (shouldChangeReview) {
			await this.setInReview(arg.inReview!, arg.source);
		}

		if (options?.preserveVisibility && !this.host.visible) return false;

		if (arg.source === 'launchpad' && this.host.visible) {
			this._shouldRefreshPullRequestDetails = true;
			this.onRefresh();
		}

		return true;
	}

	async onShowingCommit(
		arg: Partial<CommitSelectedEvent['data']> | undefined,
		options?: WebviewShowOptions,
	): Promise<boolean> {
		let data: Partial<CommitSelectedEvent['data']> | undefined;

		if (isSerializedState<State>(arg)) {
			const { commit: selected } = arg.state;
			if (selected?.repoPath != null && selected?.sha != null) {
				if (selected.stashNumber != null) {
					data = {
						commit: createReference(selected.sha, selected.repoPath, {
							refType: 'stash',
							name: selected.message,
							number: selected.stashNumber,
						}),
					};
				} else {
					data = {
						commit: createReference(selected.sha, selected.repoPath, {
							refType: 'revision',
							message: selected.message,
						}),
					};
				}
			}
		} else if (arg != null && typeof arg === 'object') {
			data = arg;
		} else {
			data = undefined;
		}

		let commit;
		if (data != null) {
			if (data.preserveFocus) {
				if (options == null) {
					options = { preserveFocus: true };
				} else {
					options.preserveFocus = true;
				}
			}
			({ commit, ...data } = data);
		}

		if (commit != null && this.mode === 'wip' && data?.interaction !== 'passive') {
			await this.setMode('commit');
		}

		if (commit == null) {
			if (!this._pinned) {
				const bestCommitState = this.getBestCommitOrStash();
				commit = bestCommitState.commit;
				// Use the cached searchContext if data doesn't provide one
				if (data == null) {
					data = { searchContext: bestCommitState.searchContext };
				} else if (data.searchContext == null) {
					data = { ...data, searchContext: bestCommitState.searchContext };
				}
			}
		}

		if (
			commit != null &&
			(!this.commit?.ref.startsWith(commit.ref) ||
				!areSearchContextsEqual(data?.searchContext, this.searchContext, false))
		) {
			await this.updateCommitState(commit, data?.searchContext, { pinned: false });
		}

		if (data?.preserveVisibility && !this.host.visible) return false;

		this._skipNextRefreshOnVisibilityChange = true;
		return true;
	}

	async trackOpenReviewMode(source?: Sources): Promise<void> {
		if (this._context.wip?.pullRequest == null) return;

		const provider = this._context.wip.pullRequest.provider.id;
		const repoPrivacy = await this.container.git.visibility(this._context.wip.repo.path);
		const filesChanged = this._context.wip.changes?.files.length ?? 0;

		this.host.sendTelemetryEvent('openReviewMode', {
			provider: provider,
			'repository.visibility': repoPrivacy,
			repoPrivacy: repoPrivacy,
			source: source ?? this.getTelemetrySource(),
			filesChanged: filesChanged,
		});
	}

	includeBootstrap(deferrable?: boolean): Promise<State> {
		if (deferrable) {
			return Promise.resolve({
				webviewId: this.host.id,
				webviewInstanceId: this.host.instanceId,
				timestamp: Date.now(),
			} as State);
		}
		return this.getState(this._context);
	}

	registerCommands(): Disposable[] {
		const subscriptions: Disposable[] = [
			registerWebviewCommand(`${this.host.id}.refresh`, () => this.host.refresh(true)),
		];

		for (const { command, handler } of getCommands()) {
			subscriptions.push(registerWebviewCommand(getWebviewCommand(command, this.host.type), handler, this));
		}

		return subscriptions;
	}

	onFocusChanged(focused: boolean): void {
		if (this._focused === focused) return;

		this._focused = focused;
		if (focused && this.isLineTrackerSuspended) {
			this.ensureTrackers();
		}
	}

	private getEncodedEntityid(pullRequest = this._context.wip?.pullRequest): string | undefined {
		if (pullRequest == null) return undefined;

		const entity = getEntityIdentifierInput(pullRequest);
		if (entity == null) return undefined;

		return EntityIdentifierUtils.encode(entity);
	}

	private async trackCreateCodeSuggestion(draft: Draft, fileCount: number) {
		if (this._context.wip?.pullRequest == null) return;

		const provider = this._context.wip.pullRequest.provider.id;
		const repoPrivacy = await this.container.git.visibility(this._context.wip.repo.path);

		this.host.sendTelemetryEvent(
			'codeSuggestionCreated',
			{
				provider: provider,
				'repository.visibility': repoPrivacy,
				repoPrivacy: repoPrivacy,
				draftId: draft.id,
				draftPrivacy: draft.visibility,
				filesChanged: fileCount,
				source: 'reviewMode',
			},
			{
				source: 'inspect-overview',
				detail: { reviewMode: true },
			},
		);
	}

	@ipcCommand(SuggestChangesCommand)
	private async onSuggestChanges(params: IpcParams<typeof SuggestChangesCommand>) {
		if (
			!(await ensureAccount(this.container, 'Code Suggestions are a Preview feature and require an account.', {
				source: 'code-suggest',
				detail: 'create',
			})) ||
			!(await confirmDraftStorage(this.container))
		) {
			return;
		}

		const createChanges: CreateDraftChange[] = [];

		const changes = Object.entries(params.changesets);
		const ignoreChecked = changes.length === 1;
		let createFileCount = 0;

		for (const [_, change] of changes) {
			if (!ignoreChecked && change.checked === false) continue;

			// we only support a single repo for now
			const repository =
				this._context.wip!.repo.id === change.repository.path ? this._context.wip!.repo : undefined;
			if (repository == null) continue;

			const { checked } = change;
			let changeRevision = { to: uncommitted, from: 'HEAD' };
			if (checked === 'staged') {
				changeRevision = { ...changeRevision, to: uncommittedStaged };
			}

			const prEntityId = this.getEncodedEntityid();
			if (prEntityId == null) continue;

			if (change.files && change.files.length > 0) {
				if (checked === 'staged') {
					createFileCount += change.files.filter(f => f.staged === true).length;
				} else {
					createFileCount += change.files.length;
				}
			}

			createChanges.push({
				repository: repository,
				revision: changeRevision,
				prEntityId: prEntityId,
			});
		}

		if (createChanges.length === 0) return;

		try {
			const entityIdentifier = getEntityIdentifierInput(this._context.wip!.pullRequest!);
			const prEntityId = EntityIdentifierUtils.encode(entityIdentifier);

			const options = {
				description: params.description,
				visibility: 'provider_access' as DraftVisibility,
				prEntityId: prEntityId,
			};

			const draft = await this.container.drafts.createDraft(
				'suggested_pr_change',
				params.title,
				createChanges,
				options,
			);

			async function showNotification() {
				const view = { title: 'View Code Suggestions' };
				const copy = { title: 'Copy Link' };
				let copied = false;
				while (true) {
					const result = await window.showInformationMessage(
						`Code Suggestion successfully created${copied ? '\u2014 link copied to the clipboard' : ''}`,
						view,
						copy,
					);

					if (result === copy) {
						void env.clipboard.writeText(draft.deepLinkUrl);
						copied = true;
						continue;
					}

					if (result === view) {
						void showPatchesView({ mode: 'view', draft: draft, source: 'notification' });
					}

					break;
				}
			}

			void showNotification();
			void this.setInReview(false);

			void this.trackCreateCodeSuggestion(draft, createFileCount);
		} catch (ex) {
			debugger;

			void window.showErrorMessage(`Unable to create draft: ${ex.message}`);
		}
	}

	private getRepoActionPath() {
		if (this._context.mode === 'wip') {
			return this._context.wip?.repo.path;
		}
		return this.commit?.repoPath;
	}

	@ipcCommand(FetchCommand)
	private onFetch() {
		const path = this.getRepoActionPath();
		if (path == null) return;
		void RepoActions.fetch(path);
	}

	@ipcCommand(PublishCommand)
	private onPublish() {
		const path = this.getRepoActionPath();
		if (path == null) return;
		void executeCoreGitCommand('git.publish', Uri.file(path));
	}

	@ipcCommand(PushCommand)
	private onPush() {
		const path = this.getRepoActionPath();
		if (path == null) return;
		void RepoActions.push(path);
	}

	@ipcCommand(PullCommand)
	private onPull() {
		const path = this.getRepoActionPath();
		if (path == null) return;
		void RepoActions.pull(path);
	}

	@ipcCommand(SwitchCommand)
	private onSwitch() {
		const path = this.getRepoActionPath();
		if (path == null) return;
		void RepoActions.switchTo(path);
	}

	private get pullRequestContext():
		| { pr: PullRequest; repoPath: string; branch?: GitBranch; commit?: GitCommit }
		| undefined {
		if (this.mode === 'wip') {
			if (this._context.wip?.pullRequest == null) return;

			return {
				repoPath: this._context.wip.repo.path,
				branch: this._context.wip.branch,
				pr: this._context.wip.pullRequest,
			};
		}

		if (this._context.pullRequest == null) return;

		return {
			repoPath: this.commit!.repoPath,
			commit: this.commit!,
			pr: this._context.pullRequest,
		};
	}

	@ipcCommand(OpenPullRequestChangesCommand)
	private onOpenPullRequestChanges() {
		if (this.pullRequestContext == null) return;

		const { repoPath, pr } = this.pullRequestContext;
		if (pr.refs == null) return;

		const refs = getComparisonRefsForPullRequest(repoPath, pr.refs);
		return openComparisonChanges(
			this.container,
			{
				repoPath: refs.repoPath,
				lhs: refs.base.ref,
				rhs: refs.head.ref,
			},
			{ title: `Changes in Pull Request #${pr.id}` },
		);
	}

	@ipcCommand(OpenPullRequestComparisonCommand)
	private onOpenPullRequestComparison() {
		if (this.pullRequestContext == null) return;

		const { repoPath, pr } = this.pullRequestContext;
		if (pr.refs == null) return;

		const refs = getComparisonRefsForPullRequest(repoPath, pr.refs);
		void this.container.views.searchAndCompare.compare(refs.repoPath, refs.head, refs.base);
	}

	@ipcCommand(OpenPullRequestOnRemoteCommand)
	private async onOpenPullRequestOnRemote(clipboard?: boolean) {
		if (this.pullRequestContext == null) return;

		const {
			pr: { url },
		} = this.pullRequestContext;
		return executeCommand<OpenPullRequestOnRemoteCommandArgs, void>('gitlens.openPullRequestOnRemote', {
			pr: { url: url },
			clipboard: clipboard,
		});
	}

	@ipcCommand(OpenPullRequestDetailsCommand)
	private async onShowPullRequestDetails() {
		if (this.pullRequestContext == null) return;

		const { pr, repoPath, branch, commit } = this.pullRequestContext;
		if (pr == null) return;

		return this.container.views.pullRequest.showPullRequest(pr, commit ?? branch ?? repoPath);
	}

	onRefresh(_force?: boolean | undefined): void {
		if (this._pinned) return;

		if (this.mode === 'wip') {
			const uri = this._context.wip?.changes?.repository.uri;
			void this.updateWipState(
				this.container.git.getBestRepositoryOrFirst(uri != null ? Uri.parse(uri) : undefined),
			);
		} else {
			const { commit, searchContext } = this.getBestCommitOrStash();
			void this.updateCommitState(commit, searchContext, { immediate: false });
		}
	}

	onReloaded(): void {
		void this.notifyDidChangeState(true);
	}

	onVisibilityChanged(visible: boolean): void {
		this.ensureTrackers();
		if (!visible) return;

		const skipRefresh = this._skipNextRefreshOnVisibilityChange;
		if (skipRefresh) {
			this._skipNextRefreshOnVisibilityChange = false;
		}

		if (!skipRefresh) {
			this.onRefresh();
		}
		void this.notifyDidChangeState(true);
	}

	private onAnyConfigurationChanged(e: ConfigurationChangeEvent) {
		if (
			configuration.changed(e, [
				'defaultDateFormat',
				'defaultDateStyle',
				'views.commitDetails.files',
				'views.commitDetails.avatars',
				'ai.enabled',
			]) ||
			configuration.changedCore(e, 'workbench.tree.renderIndentGuides') ||
			configuration.changedCore(e, 'workbench.tree.indent')
		) {
			this._context.preferences = this.getPreferences();
			void this.notifyDidChangeState();
		}

		if (
			this.commit != null &&
			configuration.changed(e, ['views.commitDetails.autolinks', 'views.commitDetails.pullRequests'])
		) {
			void this.updateCommitState(this.commit, this.searchContext, { force: true });
		}
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		void this.updateCodeSuggestions();
		this.updateHasAccount(e.current);
	}

	private updateHasAccount(subscription: Subscription) {
		const hasAccount = subscription.account != null;
		if (this._context.hasAccount === hasAccount) return;

		this.notifyDidChangeHasAccount(hasAccount);
	}

	async getHasAccount(force = false): Promise<boolean> {
		if (this._context.hasAccount != null && !force) return this._context.hasAccount;

		this._context.hasAccount = (await this.container.subscription.getSubscription())?.account != null;

		return this._context.hasAccount;
	}

	private async onIntegrationsChanged(_e: ConfiguredIntegrationsChangeEvent) {
		const previous = this._context.hasIntegrationsConnected;
		const current = await this.getHasIntegrationsConnected(true);
		if (previous === current) return;

		this.notifyDidChangeIntegrations(current);
	}

	async getHasIntegrationsConnected(force = false): Promise<boolean> {
		if (force || this._context.hasIntegrationsConnected == null) {
			const configured = await this.container.integrations.getConfigured();
			if (configured.length) {
				this._context.hasIntegrationsConnected = configured.some(i =>
					isSupportedCloudIntegrationId(i.integrationId),
				);
			} else {
				this._context.hasIntegrationsConnected = false;
			}
		}

		return this._context.hasIntegrationsConnected;
	}

	private getPreferences(): Preferences {
		return {
			pullRequestExpanded: this.container.storage.getWorkspace('views:commitDetails:pullRequestExpanded') ?? true,
			avatars: configuration.get('views.commitDetails.avatars'),
			dateFormat: configuration.get('defaultDateFormat') ?? 'MMMM Do, YYYY h:mma',
			dateStyle: configuration.get('defaultDateStyle') ?? 'relative',
			files: configuration.get('views.commitDetails.files'),
			indentGuides: configuration.getCore('workbench.tree.renderIndentGuides') ?? 'onHover',
			indent: configuration.getCore('workbench.tree.indent'),
			aiEnabled: this.container.ai.enabled,
			showSignatureBadges: configuration.get('signing.showSignatureBadges'),
		};
	}

	private onContextChanged(key: keyof ContextKeys) {
		if (['gitlens:gk:organization:ai:enabled', 'gitlens:gk:organization:drafts:enabled'].includes(key)) {
			this.notifyDidChangeOrgSettings();
		}
	}

	private getOrgSettings(): State['orgSettings'] {
		return {
			ai: getContext('gitlens:gk:organization:ai:enabled', false),
			drafts: getContext('gitlens:gk:organization:drafts:enabled', false),
		};
	}

	private onCommitSelected(e: CommitSelectedEvent) {
		if (
			e.data == null ||
			(this.options.attachedTo === 'graph' && e.source !== 'gitlens.views.graph') ||
			(this.options.attachedTo === 'default' && e.source === 'gitlens.views.graph')
		) {
			return;
		}

		if (this.options.attachedTo === 'graph' /*|| e.source === 'gitlens.graph'*/) {
			if (e.data.commit.ref === uncommitted) {
				if (this.mode !== 'wip') {
					void this.setMode('wip', this.container.git.getRepository(e.data.commit.repoPath));
				} else if (e.data.commit.repoPath !== this._context.wip?.changes?.repository.path) {
					void this.updateWipState(this.container.git.getRepository(e.data.commit.repoPath));
				}
			} else {
				if (this._pinned && e.data.interaction === 'passive') {
					this._commitStack.insert(getReferenceFromRevision(e.data.commit));
					this.updateNavigation();
				}

				if (this.mode !== 'commit') {
					void this.setMode('commit', this.container.git.getRepository(e.data.commit.repoPath));
				}

				if (!this._pinned || e.data.interaction !== 'passive') {
					void this.host.show(false, { preserveFocus: e.data.preserveFocus }, e.data);
				}
			}

			return;
		}

		if (this.mode === 'wip') {
			if (e.data.commit.repoPath !== this._context.wip?.changes?.repository.path) {
				void this.updateWipState(this.container.git.getRepository(e.data.commit.repoPath));
			}

			return;
		}

		if (this._pinned && e.data.interaction === 'passive') {
			this._commitStack.insert(getReferenceFromRevision(e.data.commit));
			this.updateNavigation();
		} else {
			void this.host.show(false, { preserveFocus: e.data.preserveFocus }, e.data);
		}
	}

	private _lineTrackerDisposable: Disposable | undefined;
	private _selectionTrackerDisposable: Disposable | undefined;
	private ensureTrackers(): void {
		this._selectionTrackerDisposable?.dispose();
		this._selectionTrackerDisposable = undefined;
		this._lineTrackerDisposable?.dispose();
		this._lineTrackerDisposable = undefined;

		if (!this.host.visible) return;

		this._selectionTrackerDisposable = this.container.events.on('commit:selected', this.onCommitSelected, this);

		if (this._pinned) return;

		if (this.options.attachedTo !== 'graph') {
			const { lineTracker } = this.container;
			this._lineTrackerDisposable = lineTracker.subscribe(
				this,
				lineTracker.onDidChangeActiveLines(this.onActiveEditorLinesChanged, this),
			);
		}
	}

	private get isLineTrackerSuspended() {
		return this.options.attachedTo !== 'graph' ? this._lineTrackerDisposable == null : false;
	}

	private suspendLineTracker() {
		// Defers the suspension of the line tracker, so that the focus change event can be handled first
		setTimeout(() => {
			this._lineTrackerDisposable?.dispose();
			this._lineTrackerDisposable = undefined;
		}, 100);
	}

	@ipcCommand(CreatePatchFromWipCommand)
	private onCreatePatchFromWip(params: IpcParams<typeof CreatePatchFromWipCommand>) {
		if (params.changes == null) return;

		const change: Change = {
			type: 'wip',
			repository: {
				name: params.changes.repository.name,
				path: params.changes.repository.path,
				uri: params.changes.repository.uri,
			},
			files: params.changes.files,
			revision: { to: uncommitted, from: 'HEAD' },
			checked: params.checked,
		};

		void showPatchesView({ mode: 'create', create: { changes: [change] } });
	}

	@ipcCommand(ShowCodeSuggestionCommand)
	private onShowCodeSuggestion(params: IpcParams<typeof ShowCodeSuggestionCommand>) {
		const draft = this._context.wip?.codeSuggestions?.find(draft => draft.id === params.id);
		if (draft == null) return;

		void showPatchesView({ mode: 'view', draft: draft, source: this.getTelemetrySource() });
	}

	private onActiveEditorLinesChanged(e: LinesChangeEvent) {
		if (e.pending || e.editor == null || e.suspended) return;

		if (this.mode === 'wip') {
			const repo = this.container.git.getBestRepositoryOrFirst(e.editor);
			void this.updateWipState(repo, true);

			return;
		}

		const line = e.selections?.[0]?.active;
		const commit = line != null ? this.container.lineTracker.getState(line)?.commit : undefined;
		void this.updateCommitState(commit, undefined);
	}

	private _wipSubscription: RepositorySubscription | undefined;

	private get mode(): Mode {
		return this._context.mode;
	}

	private async setMode(mode: Mode, repository?: Repository): Promise<void> {
		this._context.mode = mode;
		void this.notifyDidChangeState(true);
		if (mode === 'wip') {
			await this.updateWipState(repository ?? this.container.git.getBestRepositoryOrFirst());
		}

		this.updateTitle();
	}

	private updateTitle() {
		if (this.mode === 'commit') {
			if (this.commit == null) {
				this.host.title = this.host.originalTitle;
			} else {
				let following = 'Commit Details';
				if (this.commit.refType === 'stash') {
					following = 'Stash Details';
				} else if (this.commit.isUncommitted) {
					following = 'Uncommitted Changes';
				}

				this.host.title = `${this.host.originalTitle}: ${following}`;
			}
		} else {
			this.host.title = `${this.host.originalTitle}: Overview`;
		}
	}

	@ipcRequest(ExplainRequest)
	private async onExplainRequest(): Promise<IpcResponse<typeof ExplainRequest>> {
		try {
			// check for uncommitted changes
			if (this.commit != null && (this.commit.isUncommitted || this.commit.isUncommittedStaged)) {
				await executeCommand<ExplainWipCommandArgs>('gitlens.ai.explainWip', {
					repoPath: this.commit.repoPath,
					source: { source: this.getTelemetrySource(), context: { type: 'wip' } },
				});
			} else {
				const isStashCommit = isStash(this.commit);
				await executeCommand<ExplainCommitCommandArgs | ExplainStashCommandArgs>(
					isStashCommit ? 'gitlens.ai.explainStash' : 'gitlens.ai.explainCommit',
					{
						repoPath: this.commit!.repoPath,
						rev: this.commit!.sha,
						source: {
							source: this.getTelemetrySource(),
							context: { type: isStashCommit ? 'stash' : 'commit' },
						},
					},
				);
			}

			return { result: { summary: '', body: '' } };
		} catch (ex) {
			debugger;
			return { error: { message: ex.message } };
		}
	}

	@ipcRequest(GenerateRequest)
	private async onGenerateRequest(): Promise<IpcResponse<typeof GenerateRequest>> {
		const repo: Repository | undefined = this._context.wip?.repo;

		if (!repo) {
			return { error: { message: 'Unable to find changes' } };
		}

		try {
			// TODO@eamodio HACK -- only works for the first patch
			// const patch = await this.getDraftPatch(this._context.draft);
			// if (patch == null) throw new Error('Unable to find patch');

			// const commit = await this.getOrCreateCommitForPatch(patch.gkRepositoryId);
			// if (commit == null) throw new Error('Unable to find commit');

			const result = await this.container.ai.actions.generateCreateDraft(
				repo,
				{ source: this.getTelemetrySource(), context: { type: 'suggested_pr_change' } },
				{ progress: { location: { viewId: this.host.id } } },
			);
			if (result === 'cancelled') throw new Error('Operation was canceled');

			if (result == null) throw new Error('Error retrieving content');

			return {
				title: result.result.summary,
				description: result.result.body,
			};
		} catch (ex) {
			debugger;
			return { error: { message: ex.message } };
		}
	}

	@ipcRequest(ReachabilityRequest)
	private async onReachabilityRequest(): Promise<IpcResponse<typeof ReachabilityRequest>> {
		const startTime = Date.now();

		try {
			const commit = this.commit;
			if (commit == null) {
				return {
					error: { message: 'Unable to find commit' },
					duration: Date.now() - startTime,
				};
			}

			const result = await this.container.git
				.getRepositoryService(commit.repoPath)
				.commits.getCommitReachability?.(commit.sha, this._cancellationTokenSource?.token);

			const duration = Date.now() - startTime;

			this.host.sendTelemetryEvent(
				`${this.options.attachedTo === 'graph' ? 'graphDetails' : 'commitDetails'}/reachability/loaded`,
				{
					'refs.count': result?.refs.length ?? 0,
					duration: duration,
				},
			);

			return { refs: result?.refs ?? [], duration: duration };
		} catch (ex) {
			const duration = Date.now() - startTime;
			const errorMessage = ex instanceof Error ? ex.message : String(ex);

			this.host.sendTelemetryEvent(
				`${this.options.attachedTo === 'graph' ? 'graphDetails' : 'commitDetails'}/reachability/failed`,
				{
					duration: duration,
					'failed.reason': ex instanceof Error && ex.name === 'CancellationError' ? 'timeout' : 'git-error',
					'failed.error': errorMessage,
				},
			);

			return {
				error: { message: 'Failed trying to find branches or tags that contain this commit' },
				duration: duration,
			};
		}
	}

	@ipcCommand(NavigateCommand)
	private onNavigateStack(params: IpcParams<typeof NavigateCommand>) {
		const commit = this._commitStack.navigate(params.direction);
		if (commit == null) return;

		void this.updateCommitState(commit, undefined, { immediate: true, skipStack: true });
	}

	private _cancellationTokenSource: CancellationTokenSource | undefined = undefined;

	@trace({ args: false })
	protected async getState(current: Context): Promise<State> {
		if (this._cancellationTokenSource != null) {
			this._cancellationTokenSource.cancel();
			this._cancellationTokenSource = undefined;
		}

		let details;
		if (current.commitState.commit != null) {
			details = await this.getDetailsModel(current.commitState.commit, current.formattedMessage);
		}

		const wip = current.wip;
		if (wip == null && this._repositorySubscription) {
			this._cancellationTokenSource ??= new CancellationTokenSource();
			const cancellation = this._cancellationTokenSource.token;
			setTimeout(() => {
				if (cancellation.isCancellationRequested) return;
				void this.updateWipState(this._repositorySubscription?.repo);
			}, 100);
		}

		current.hasAccount ??= await this.getHasAccount();
		current.hasIntegrationsConnected ??= await this.getHasIntegrationsConnected();

		const state: State = {
			...this.host.baseWebviewState,
			mode: current.mode,
			commit: details,
			navigationStack: current.navigationStack,
			pinned: current.pinned,
			preferences: current.preferences,
			autolinksEnabled: current.autolinksEnabled,
			experimentalComposerEnabled: current.experimentalComposerEnabled,
			autolinkedIssues: current.autolinkedIssues, //?.map(serializeIssueOrPullRequest),
			pullRequest: current.pullRequest, // != null ? serializePullRequest(current.pullRequest) : undefined,
			wip: serializeWipContext(wip),
			orgSettings: current.orgSettings,
			inReview: current.inReview,
			hasAccount: current.hasAccount,
			hasIntegrationsConnected: current.hasIntegrationsConnected,
			searchContext: current.commitState.searchContext,
		};
		return state;
	}

	@trace({ args: false })
	private async updateWipState(repository: Repository | undefined, onlyOnRepoChange = false): Promise<void> {
		if (this._wipSubscription != null) {
			const { repo, subscription } = this._wipSubscription;
			if (repository?.path !== repo.path) {
				subscription.dispose();
				this._wipSubscription = undefined;
			} else if (onlyOnRepoChange) {
				return;
			}
		}

		let wip: WipContext | undefined = undefined;
		let inReview = this.inReview;

		if (repository != null) {
			this._wipSubscription ??= { repo: repository, subscription: this.subscribeToRepositoryWip(repository) };

			const changes = await this.getWipChange(repository);
			wip = {
				changes: changes,
				repo: repository,
				repositoryCount: this.container.git.openRepositoryCount,
			};

			if (changes != null) {
				const branchDetails = await this.getWipBranchDetails(repository, changes.branchName);
				if (branchDetails != null) {
					wip.branch = branchDetails.branch;
					wip.pullRequest = branchDetails.pullRequest;
					wip.codeSuggestions = branchDetails.codeSuggestions;
				}
			}

			if (wip.pullRequest?.state !== 'opened') {
				inReview = false;
			}

			// TODO: Move this into the correct place. It is being called here temporarily to guarantee it gets an up-to-date PR.
			// Once moved, we may not need the "source" property on context anymore.
			if (
				this._shouldRefreshPullRequestDetails &&
				wip.pullRequest != null &&
				this._context.source === 'launchpad'
			) {
				void this.container.views.pullRequest.showPullRequest(wip.pullRequest, wip.branch ?? repository.path);
				this._shouldRefreshPullRequestDetails = false;
			}

			const success = await this.host.notify(DidChangeWipStateNotification, {
				wip: serializeWipContext(wip),
				inReview: inReview,
			});
			if (success) {
				this._context.wip = wip;
				this._context.inReview = inReview;
				return;
			}
		}

		this._context.wip = wip;
		this._context.inReview = inReview;
		void this.notifyDidChangeState(true);
	}

	private async getWipBranchDetails(
		repository: Repository,
		branchName: string,
	): Promise<{ branch: GitBranch; pullRequest: PullRequest | undefined; codeSuggestions: Draft[] } | undefined> {
		const branch = await repository.git.branches.getBranch(branchName);
		if (branch == null) return undefined;

		if (this.mode === 'commit') {
			return {
				branch: branch,
				pullRequest: undefined,
				codeSuggestions: [],
			};
		}

		const pullRequest = await branch.getAssociatedPullRequest({
			expiryOverride: 1000 * 60 * 5, // 5 minutes
		});

		let codeSuggestions: Draft[] = [];
		if (pullRequest != null && supportsCodeSuggest(pullRequest.provider)) {
			const results = await this.getCodeSuggestions(pullRequest, repository);
			if (results.length) {
				codeSuggestions = results;
			}
		}

		return {
			branch: branch,
			pullRequest: pullRequest,
			codeSuggestions: codeSuggestions,
		};
	}

	private async canAccessDrafts(): Promise<boolean> {
		if ((await this.getHasAccount()) === false) return false;

		return getContext('gitlens:gk:organization:drafts:enabled', false);
	}

	private async getCodeSuggestions(pullRequest: PullRequest, repository: Repository): Promise<Draft[]> {
		if (!(await this.canAccessDrafts()) || !supportsCodeSuggest(pullRequest.provider)) return [];

		const results = await this.container.drafts.getCodeSuggestions(pullRequest, repository);

		for (const draft of results) {
			if (draft.author.avatarUri != null || draft.organizationId == null) continue;

			let email = draft.author.email;
			if (email == null) {
				const user = await this.container.organizations.getMemberById(draft.author.id, draft.organizationId);
				email = user?.email;
			}
			if (email == null) continue;

			draft.author.avatarUri = getAvatarUri(email);
		}

		return results;
	}

	private async updateCodeSuggestions() {
		if (this.mode !== 'wip' || this._context.wip?.pullRequest == null) {
			return;
		}

		const wip = this._context.wip;
		const { pullRequest, repo } = wip;

		wip.codeSuggestions = supportsCodeSuggest(pullRequest!.provider)
			? await this.getCodeSuggestions(pullRequest!, repo)
			: [];

		const success = await this.host.notify(DidChangeWipStateNotification, { wip: serializeWipContext(wip) });
		if (success) {
			this._context.wip = wip;
			return;
		}

		this._context.wip = wip;
		void this.notifyDidChangeState(true);
	}

	private _repositorySubscription: RepositorySubscription | undefined;

	private async updateCommitState(
		commitish: GitCommit | GitRevisionReference | undefined,
		searchContext: GitCommitSearchContext | undefined,
		options?: {
			force?: boolean;
			pinned?: boolean;
			immediate?: boolean;
			skipStack?: boolean;
		},
	) {
		if (
			!options?.force &&
			this.commit?.sha === commitish?.ref &&
			areSearchContextsEqual(searchContext, this.searchContext, false)
		) {
			return;
		}

		let commit: GitCommit | undefined;
		if (isCommit(commitish)) {
			commit = commitish;
		} else if (commitish != null) {
			if (commitish.refType === 'stash') {
				const stash = await this.container.git.getRepositoryService(commitish.repoPath).stash?.getStash();
				commit = stash?.stashes.get(commitish.ref);
			} else {
				commit = await this.container.git
					.getRepositoryService(commitish.repoPath)
					.commits.getCommit(commitish.ref);
			}
		}

		let wip = this._context.wip;

		if (this._repositorySubscription != null) {
			const { repo, subscription } = this._repositorySubscription;
			if (commit?.repoPath !== repo.path) {
				subscription.dispose();
				this._repositorySubscription = undefined;
				wip = undefined;
			}
		}

		if (this._repositorySubscription == null && commit != null) {
			const repo = await this.container.git.getOrOpenRepository(commit.repoPath);
			if (repo != null) {
				this._repositorySubscription = { repo: repo, subscription: this.subscribeToRepositoryWip(repo) };

				if (this.mode === 'wip') {
					void this.updateWipState(repo);
				} else {
					wip = undefined;
				}
			}
		}

		this._context.commitState = { commit: commit, searchContext: searchContext };

		this._context.autolinksEnabled = configuration.get('views.commitDetails.autolinks.enabled');
		this._context.experimentalComposerEnabled = configuration.get(
			'ai.experimental.composer.enabled',
			undefined,
			false,
		);
		this._context.formattedMessage = undefined;
		this._context.autolinkedIssues = undefined;
		this._context.pullRequest = undefined;
		this._context.wip = wip;

		if (options?.pinned != null) {
			this.onUpdatePinned({ pin: options.pinned });
		}

		if (this.isLineTrackerSuspended) {
			this.ensureTrackers();
		}

		if (commit != null) {
			if (!options?.skipStack) {
				this._commitStack.add(getReferenceFromRevision(commit));
			}

			this.updateNavigation();
		}
		this.notifyDidChangeCommit(options?.immediate ?? true);
		this.updateTitle();
	}

	private subscribeToRepositoryWip(repo: Repository) {
		return Disposable.from(
			repo.watchFileSystem(1000),
			repo.onDidChangeFileSystem(() => this.onWipChanged(repo)),
			repo.onDidChange(e => {
				if (e.changed('index')) {
					this.onWipChanged(repo);
				}
			}),
		);
	}

	private onWipChanged(repository: Repository) {
		void this.updateWipState(repository);
	}

	private async getWipChange(repository: Repository): Promise<WipChange | undefined> {
		const status = await this.container.git.getRepositoryService(repository.path).status.getStatus();
		if (status == null) return undefined;

		const files: GitFileChangeShape[] = [];
		for (const file of status.files) {
			const change = {
				repoPath: file.repoPath,
				path: file.path,
				status: file.status,
				originalPath: file.originalPath,
				staged: file.staged,
			};

			files.push(change);
			if (file.staged && file.wip) {
				files.push({ ...change, staged: false });
			}
		}

		return {
			repository: {
				name: repository.name,
				path: repository.path,
				uri: repository.uri.toString(),
			},
			branchName: status.branch,
			files: files,
		};
	}

	@ipcCommand(PinCommand)
	private onUpdatePinned(params: IpcParams<typeof PinCommand>) {
		if (params.pin === this._context.pinned) return;

		this._pinned = params.pin;
		this.ensureTrackers();

		this._context.pinned = params.pin;
		this.notifyDidChangeCommit(true);
	}

	@ipcCommand(UpdatePreferencesCommand)
	private onUpdatePreferences(params: IpcParams<typeof UpdatePreferencesCommand>) {
		if (
			this._context.preferences?.pullRequestExpanded === params.pullRequestExpanded &&
			this._context.preferences?.files?.compact === params.files?.compact &&
			this._context.preferences?.files?.icon === params.files?.icon &&
			this._context.preferences?.files?.layout === params.files?.layout &&
			this._context.preferences?.files?.threshold === params.files?.threshold
		) {
			return;
		}

		const changes: Preferences = {
			...this._context.preferences,
		};

		if (
			params.pullRequestExpanded != null &&
			this._context.preferences?.pullRequestExpanded !== params.pullRequestExpanded
		) {
			void this.container.storage
				.storeWorkspace('views:commitDetails:pullRequestExpanded', params.pullRequestExpanded)
				.catch();

			changes.pullRequestExpanded = params.pullRequestExpanded;
		}

		if (params.files != null) {
			if (this._context.preferences?.files?.compact !== params.files?.compact) {
				void configuration.updateEffective('views.commitDetails.files.compact', params.files?.compact);
			}
			if (this._context.preferences?.files?.icon !== params.files?.icon) {
				void configuration.updateEffective('views.commitDetails.files.icon', params.files?.icon);
			}
			if (this._context.preferences?.files?.layout !== params.files?.layout) {
				void configuration.updateEffective('views.commitDetails.files.layout', params.files?.layout);
			}
			if (this._context.preferences?.files?.threshold !== params.files?.threshold) {
				void configuration.updateEffective('views.commitDetails.files.threshold', params.files?.threshold);
			}

			changes.files = params.files;
		}

		this._context.preferences = changes;
		this.notifyDidChangeCommit();
	}

	private _notifyDidChangeCommitDebounced: Deferrable<() => void> | undefined = undefined;

	private notifyDidChangeCommit(immediate: boolean = false) {
		if (immediate) {
			void this.notifyDidChangeState();
			return;
		}

		this._notifyDidChangeCommitDebounced ??= debounce(this.notifyDidChangeState.bind(this), 500);
		this._notifyDidChangeCommitDebounced();
	}

	private notifyDidChangeOrgSettings() {
		this._context.orgSettings = this.getOrgSettings();
		void this.host.notify(DidChangeOrgSettingsNotification, {
			orgSettings: this._context.orgSettings,
		});
	}

	private notifyDidChangeHasAccount(hasAccount: boolean) {
		this._context.hasAccount = hasAccount;
		void this.host.notify(DidChangeHasAccountNotification, { hasAccount: hasAccount });
	}

	private notifyDidChangeIntegrations(hasIntegrationsConnected: boolean) {
		this._context.hasIntegrationsConnected = hasIntegrationsConnected;
		void this.host.notify(DidChangeIntegrationsNotification, {
			hasIntegrationsConnected: hasIntegrationsConnected,
		});
	}

	private updateNavigation() {
		let sha = this._commitStack.get(this._commitStack.position - 1)?.ref;
		if (sha != null) {
			sha = shortenRevision(sha);
		}
		this._context.navigationStack = {
			count: this._commitStack.count,
			position: this._commitStack.position,
			hint: sha,
		};
		this.notifyDidChangeCommit();
	}

	@ipcCommand(ChangeReviewModeCommand)
	private async onChangeReviewModeCommand(params: IpcParams<typeof ChangeReviewModeCommand>) {
		await this.setInReview(params.inReview, 'inspect-overview');
	}

	private async setInReview(inReview: boolean, source?: Sources) {
		if (this.inReview === inReview) return;

		const success = await this.host.notify(DidChangeDraftStateNotification, { inReview: inReview });
		if (success) {
			this._context.inReview = inReview;
			if (inReview && source != null) {
				void this.trackOpenReviewMode(source);
			}
			return;
		}

		this._context.inReview = inReview;
		void this.notifyDidChangeState(true);

		if (inReview && source != null) {
			void this.trackOpenReviewMode(source);
		}
	}

	private async notifyDidChangeState(_force?: boolean) {
		const scope = getScopedLogger();

		this._notifyDidChangeCommitDebounced?.cancel();

		return window.withProgress({ location: { viewId: this.host.id } }, async () => {
			try {
				await this.host.notify(DidChangeNotification, {
					state: await this.getState(this._context),
				});
			} catch (ex) {
				scope?.error(ex);
				debugger;
			}
		});
	}

	private getBestCommitOrStash(): {
		commit: GitCommit | GitRevisionReference | undefined;
		searchContext: GitCommitSearchContext | undefined;
	} {
		if (this._pinned) return { commit: undefined, searchContext: undefined };

		let commit: GitCommit | GitRevisionReference | undefined;
		let searchContext: GitCommitSearchContext | undefined;

		if (this.options.attachedTo !== 'graph' && window.activeTextEditor != null) {
			const { lineTracker } = this.container;
			const line = lineTracker.selections?.[0].active;
			if (line != null) {
				commit = lineTracker.getState(line)?.commit;
			}
		}

		if (commit == null) {
			// For graphDetails, use source-specific cache to avoid stale data from other contexts
			if (this.options.attachedTo === 'graph') {
				const args = this.container.events.getCachedEventArgsBySource('commit:selected', 'gitlens.views.graph');
				commit = args?.commit;
				searchContext = args?.searchContext;
			} else {
				// For commitDetails, use the general cache (for backward compatibility)
				const args = this.container.events.getCachedEventArgs('commit:selected');
				commit = args?.commit;
				searchContext = args?.searchContext;
			}
		}

		return { commit: commit, searchContext: searchContext };
	}

	private async getDetailsModel(commit: GitCommit, formattedMessage?: string): Promise<CommitDetails> {
		const [commitResult, avatarUriResult, remoteResult] = await Promise.allSettled([
			!commit.hasFullDetails()
				? commit.ensureFullDetails({ include: { uncommittedFiles: true } }).then(() => commit)
				: commit,
			commit.author.getAvatarUri(commit, { size: 32 }),
			this.container.git
				.getRepositoryService(commit.repoPath)
				.remotes.getBestRemoteWithIntegration({ includeDisconnected: true }),
		]);

		commit = getSettledValue(commitResult, commit);
		const avatarUri = getSettledValue(avatarUriResult);
		const remote = getSettledValue(remoteResult);
		formattedMessage ??= this.getFormattedMessage(commit, remote);

		const autolinks =
			commit.message != null ? await this.container.autolinks.getAutolinks(commit.message, remote) : undefined;

		return {
			repoPath: commit.repoPath,
			sha: commit.sha,
			shortSha: commit.shortSha,
			author: { ...commit.author, avatar: avatarUri?.toString(true) },
			committer: { ...commit.committer, avatar: undefined },
			message: formattedMessage,
			parents: commit.parents,
			stashNumber: commit.refType === 'stash' ? commit.stashNumber : undefined,
			files: commit.isUncommitted ? commit.anyFiles : commit.fileset?.files,
			stats: commit.stats,
			autolinks: autolinks != null ? [...map(autolinks.values(), serializeAutolink)] : undefined,

			enriched: this.getEnrichedState(commit, remote),
		};
	}

	@trace({ args: false })
	private async getEnrichedState(
		commit: GitCommit,
		remote: GitRemote | undefined,
	): Promise<NonNullable<Awaited<NonNullable<State['commit']>['enriched']>>> {
		const [enrichedAutolinksResult, prResult, signatureResult] = await Promise.allSettled([
			remote?.provider != null &&
			configuration.get('views.commitDetails.autolinks.enabled') &&
			configuration.get('views.commitDetails.autolinks.enhanced')
				? pauseOnCancelOrTimeoutMapTuplePromise(
						commit.getEnrichedAutolinks(remote as GitRemote<RemoteProvider>),
					)
				: undefined,
			remote?.provider != null && configuration.get('views.commitDetails.pullRequests.enabled')
				? commit.getAssociatedPullRequest(remote as GitRemote<RemoteProvider>)
				: undefined,
			configuration.get('signing.showSignatureBadges') ? commit.getSignature() : undefined,
		]);
		const enrichedAutolinks = getSettledValue(enrichedAutolinksResult)?.value;
		const pr = getSettledValue(prResult);
		const signature = getSettledValue(signatureResult);

		const issues =
			enrichedAutolinks != null
				? [
						...filterMap(enrichedAutolinks.values(), ([issueOrPullRequest]) =>
							issueOrPullRequest?.value != null
								? serializeIssueOrPullRequest(issueOrPullRequest.value)
								: undefined,
						),
					]
				: [];

		return {
			formattedMessage: this.getFormattedMessage(commit, remote, enrichedAutolinks),
			associatedPullRequest: pr != null ? serializePullRequest(pr) : undefined,
			autolinkedIssues: issues,
			signature: signature != null ? serializeSignature(signature) : undefined,
		};
	}

	private getFormattedMessage(
		commit: GitCommit,
		remote: GitRemote | undefined,
		enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
	) {
		let message = CommitFormatter.fromTemplate(`\${message}`, commit);
		const index = message.indexOf('\n');
		if (index !== -1) {
			message = `${message.substring(0, index)}${messageHeadlineSplitterToken}${message.substring(index + 1)}`;
		}

		if (!configuration.get('views.commitDetails.autolinks.enabled')) return message;

		return this.container.autolinks.linkify(
			message,
			'html',
			remote != null ? [remote] : undefined,
			enrichedAutolinks,
		);
	}

	private async getFileCommitFromContextOrParams(
		item: DetailsItemContext | ExecuteFileActionParams | undefined,
	): Promise<[commit: GitCommit, file: GitFileChange] | [commit?: undefined, file?: undefined]> {
		if (item == null) return [];

		if (isDetailsItemContext(item)) {
			if (!isDetailsFileContext(item)) return [];

			return getFileCommitFromContext(this.container, item.webviewItemValue);
		}

		return this.getFileCommitFromParams(item);
	}

	private async getFileCommitFromParams(
		params: ExecuteFileActionParams,
	): Promise<[commit: GitCommit, file: GitFileChange] | [commit?: undefined, file?: undefined]> {
		let commit: GitCommit | undefined;
		if (this.mode === 'wip') {
			const uri = this._context.wip?.changes?.repository.uri;
			if (uri == null) return [];

			commit = await this.container.git.getRepositoryService(Uri.parse(uri)).commits.getCommit(uncommitted);
		} else {
			commit = this.commit;
		}

		commit = await commit?.getCommitForFile(params.path, params.staged);
		return commit != null ? [commit, commit.file!] : [];
	}

	@ipcCommand(PickCommitCommand)
	private onShowCommitPicker() {
		void executeGitCommand({
			command: 'log',
			state: { reference: 'HEAD', repo: this.commit?.repoPath, openPickInView: true },
		});
	}

	@ipcCommand(SearchCommitCommand)
	private onShowCommitSearch() {
		void executeGitCommand({ command: 'search', state: { openPickInView: true } });
	}

	@ipcCommand(ExecuteCommitActionCommand)
	private onExecuteCommitAction(params: IpcParams<typeof ExecuteCommitActionCommand>) {
		switch (params.action) {
			case 'graph': {
				let ref: GitRevisionReference | undefined;
				if (this._context.mode === 'wip') {
					ref =
						this._context.wip?.changes != null
							? createReference(uncommitted, this._context.wip.changes.repository.path, {
									refType: 'revision',
								})
							: undefined;
				} else {
					ref = this.commit != null ? getReferenceFromRevision(this.commit) : undefined;
				}
				if (ref == null) return;

				void executeCommand<ShowInCommitGraphCommandArgs>(
					this.options.attachedTo === 'graph' ? 'gitlens.showInCommitGraphView' : 'gitlens.showInCommitGraph',
					{ ref: ref, source: { source: this.getTelemetrySource() } },
				);
				break;
			}
			case 'more':
				this.showCommitActions();
				break;

			case 'scm':
				void executeCoreCommand('workbench.view.scm');
				break;

			case 'sha':
				if (this.commit != null) {
					if (params.alt) {
						void executeCommand<CopyMessageToClipboardCommandArgs>('gitlens.copyMessageToClipboard', {
							message: this.commit.message,
						});
					} else if (isStash(this.commit)) {
						void env.clipboard.writeText(this.commit.stashName);
					} else {
						void executeCommand<CopyShaToClipboardCommandArgs>('gitlens.copyShaToClipboard', {
							sha: this.commit.sha,
						});
					}
				}
				break;
		}
	}

	private showCommitActions() {
		if (this.commit == null || this.commit.isUncommitted) return;

		void showDetailsQuickPick(this.commit);
	}

	@ipcCommand(ExecuteFileActionCommand)
	private async onShowFileActions(params: IpcParams<typeof ExecuteFileActionCommand>) {
		const [commit, file] = await this.getFileCommitFromParams(params);
		if (commit == null) return;

		this.suspendLineTracker();
		void showDetailsQuickPick(commit, file);
	}

	@ipcCommand(SwitchModeCommand)
	private onSwitchMode(params: IpcParams<typeof SwitchModeCommand>) {
		if (this.mode === params.mode) return;

		const currentMode = this.mode;

		let repo;
		if (params.mode === 'wip') {
			let { repoPath } = params;
			if (repoPath == null) {
				repo = this.container.git.getBestRepositoryOrFirst();
				if (repo == null) return;

				repoPath = repo.path;
			} else {
				repo = this.container.git.getRepository(repoPath)!;
			}
		}

		void this.setMode(params.mode, repo);

		this.host.sendTelemetryEvent(
			`${this.options.attachedTo === 'graph' ? 'graphDetails' : 'commitDetails'}/mode/changed`,
			{
				'mode.old': currentMode,
				'mode.new': params.mode,
			},
		);
	}

	@ipcCommand(OpenFileComparePreviousCommand)
	@command('gitlens.views.openChanges:')
	@debug()
	private async openChanges(item: DetailsItemContext | ExecuteFileActionParams | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		this.suspendLineTracker();
		void openChanges(file, commit, { preserveFocus: true, preview: true, ...this.getShowOptions(item) });
		this.container.events.fire('file:selected', { uri: file.uri }, { source: this.host.id });
	}

	@ipcCommand(OpenFileCompareWorkingCommand)
	@command('gitlens.views.openChangesWithWorking:')
	@debug()
	private async openFileChangesWithWorking(item: DetailsItemContext | ExecuteFileActionParams | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		this.suspendLineTracker();
		void openChangesWithWorking(file, commit, {
			preserveFocus: true,
			preview: true,
			...this.getShowOptions(item),
		});
	}

	@command('gitlens.views.openPreviousChangesWithWorking:')
	@debug()
	private async openPreviousFileChangesWithWorking(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		this.suspendLineTracker();
		void openChangesWithWorking(
			file,
			{ repoPath: commit.repoPath, ref: commit.unresolvedPreviousSha },
			{ preserveFocus: true, preview: true, ...this.getShowOptions(item) },
		);
		this.container.events.fire('file:selected', { uri: file.uri }, { source: this.host.id });
	}

	@ipcCommand(OpenFileCommand)
	@command('gitlens.views.openFile:')
	@debug()
	private async openFile(item: DetailsItemContext | ExecuteFileActionParams | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		// if (file.submodule != null) {
		// 	const submodulePath = this.container.git.getAbsoluteUri(file.path, commit.repoPath).fsPath;
		// 	const submoduleRepo = this.container.git.getRepository(submodulePath);
		// 	if (submoduleRepo != null) {
		// 		const ref = createReference(file.submodule.oid, submoduleRepo.path, { refType: 'revision' });
		// 		void showInspectView({ commit: ref });
		// 	}
		// 	return;
		// }

		this.suspendLineTracker();
		void openFile(file, commit, { preserveFocus: true, preview: true });
	}

	@ipcCommand(OpenFileOnRemoteCommand)
	@command('gitlens.openFileOnRemote:')
	@debug()
	private async openFileOnRemote(item: DetailsItemContext | ExecuteFileActionParams | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void openFileOnRemote(file, commit);
	}

	@ipcCommand(StageFileCommand)
	@command('gitlens.views.stageFile:')
	@debug()
	private async stageFile(item: DetailsItemContext | ExecuteFileActionParams | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		await this.container.git.getRepositoryService(commit.repoPath).staging?.stageFile(file.uri);
	}

	@ipcCommand(UnstageFileCommand)
	@command('gitlens.views.unstageFile:')
	@debug()
	private async unstageFile(item: DetailsItemContext | ExecuteFileActionParams | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		await this.container.git.getRepositoryService(commit.repoPath).staging?.unstageFile(file.uri);
	}

	private getShowOptions(
		item: DetailsItemContext | ExecuteFileActionParams | undefined,
	): TextDocumentShowOptions | undefined {
		return isDetailsItemContext(item) ? undefined : item?.showOptions;

		// return getContext('gitlens:webview:graph:active') || getContext('gitlens:webview:rebase:active')
		// 	? { ...params.showOptions, viewColumn: ViewColumn.Beside } : params.showOptions;
	}

	@command('gitlens.views.copy:')
	@debug()
	private async copy(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void env.clipboard.writeText(file.path);
	}

	@command('gitlens.copyRelativePathToClipboard:')
	@debug()
	private async copyRelativePath(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		const path = this.container.git.getRelativePath(file.uri, commit.repoPath);
		void env.clipboard.writeText(path);
	}

	@command('gitlens.copyPatchToClipboard:')
	@debug()
	private async copyPatch(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		let args: CreatePatchCommandArgs;
		if (commit.isUncommitted) {
			const to = commit.isUncommittedStaged ? uncommittedStaged : uncommitted;
			args = {
				repoPath: commit.repoPath,
				to: to,
				title: to === uncommittedStaged ? 'Staged Changes' : 'Uncommitted Changes',
				uris: [file.uri],
			};
		} else {
			if (commit.message == null) {
				await commit.ensureFullDetails();
			}

			const { summary: title, body: description } = splitCommitMessage(commit.message);

			args = {
				repoPath: commit.repoPath,
				to: commit.ref,
				from: `${commit.ref}^`,
				title: title,
				description: description,
				uris: [file.uri],
			};
		}

		void executeCommand<CreatePatchCommandArgs>('gitlens.copyPatchToClipboard', args);
	}

	@command('gitlens.views.openFileRevision:')
	@debug()
	private async openFileRevision(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		// if (file.submodule != null) {
		// 	const submodulePath = this.container.git.getAbsoluteUri(file.path, commit.repoPath).fsPath;
		// 	const submoduleRepo = this.container.git.getRepository(submodulePath);
		// 	if (submoduleRepo != null) {
		// 		const ref = createReference(file.submodule.oid, submoduleRepo.path, { refType: 'revision' });
		// 		void showInspectView({ commit: ref });
		// 	}
		// 	return;
		// }

		this.suspendLineTracker();
		void openFileAtRevision(file, commit, { preserveFocus: true, preview: false });
	}

	@command('gitlens.openFileHistory:')
	@debug()
	private async openFileHistory(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand('gitlens.openFileHistory', file.uri);
	}

	@command('gitlens.quickOpenFileHistory:')
	@debug()
	private async quickOpenFileHistory(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand('gitlens.quickOpenFileHistory', file.uri);
	}

	@command('gitlens.visualizeHistory.file:')
	@debug()
	private async visualizeFileHistory(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand('gitlens.visualizeHistory.file', file.uri);
	}

	@command('gitlens.openFileHistoryInGraph:')
	@debug()
	private async openFileHistoryInGraph(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand('gitlens.openFileHistoryInGraph', file.uri);
	}

	@command('gitlens.restore.file:')
	@debug()
	private async restoreFile(item: DetailsItemContext | undefined) {
		if (!isDetailsFileContext(item)) return;

		const { path, repoPath, sha } = item.webviewItemValue;
		if (sha == null || sha === uncommitted) return;

		try {
			await this.container.git.getRepositoryService(repoPath).ops?.checkout(sha, { path: path });
		} catch (ex) {
			if (CheckoutError.is(ex)) {
				void showGitErrorMessage(ex);
			} else {
				void showGitErrorMessage(ex, 'Unable to restore file');
			}
		}
	}

	@command('gitlens.restorePrevious.file:')
	@debug()
	private async restorePreviousFile(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void restoreFile(file, commit, true);
	}

	@command('gitlens.views.selectFileForCompare:')
	@debug()
	private selectFileForCompare(item: DetailsItemContext | undefined) {
		if (!isDetailsFileContext(item)) return;

		const { repoPath, sha } = item.webviewItemValue;
		const uri = getUriFromContext(this.container, item.webviewItemValue);
		if (uri == null) return;

		void setContext('gitlens:views:canCompare:file', { ref: sha ?? uncommitted, repoPath: repoPath, uri: uri });
	}

	@command('gitlens.views.compareFileWithSelected:')
	@debug()
	private async compareFileWithSelected(item: DetailsItemContext | undefined) {
		const selectedFile = getContext('gitlens:views:canCompare:file');
		if (selectedFile == null || !isDetailsFileContext(item)) return;

		void setContext('gitlens:views:canCompare:file', undefined);

		const { repoPath, sha } = item.webviewItemValue;
		if (selectedFile.repoPath !== repoPath) {
			this.selectFileForCompare(item);
			return;
		}

		const uri = getUriFromContext(this.container, item.webviewItemValue);
		if (uri == null) return;

		await this.compareFileWith(selectedFile.repoPath, selectedFile.uri, selectedFile.ref, uri, sha ?? uncommitted);
	}

	private async compareFileWith(
		repoPath: string,
		lhsUri: Uri,
		lhsRef: string,
		rhsUri: Uri | undefined,
		rhsRef: string,
	) {
		rhsUri ??= await this.container.git.getRepositoryService(repoPath).getWorkingUri(lhsUri);

		return executeCommand<DiffWithCommandArgs, void>('gitlens.diffWith', {
			repoPath: repoPath,
			lhs: { sha: lhsRef, uri: lhsUri },
			rhs: { sha: rhsRef, uri: rhsUri ?? lhsUri },
		});
	}

	@command('gitlens.views.applyChanges:')
	@debug()
	private async applyChanges(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void applyChanges(file, commit);
	}

	@command('gitlens.views.mergeChangesWithWorking:')
	@debug()
	private async mergeChangesWithWorking(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		const svc = this.container.git.getRepositoryService(commit.repoPath);
		if (svc == null) return;

		const nodeUri = await svc.getBestRevisionUri(file.path, commit.ref);
		if (nodeUri == null) return;

		const input1: MergeEditorInputs['input1'] = {
			uri: nodeUri,
			title: `Incoming`,
			detail: ` ${commit.shortSha}`,
		};

		const [mergeBaseResult, workingUriResult] = await Promise.allSettled([
			svc.refs.getMergeBase(commit.ref, 'HEAD'),
			svc.getWorkingUri(file.uri),
		]);

		const workingUri = getSettledValue(workingUriResult);
		if (workingUri == null) {
			void window.showWarningMessage('Unable to open the merge editor, no working file found');
			return;
		}
		const input2: MergeEditorInputs['input2'] = {
			uri: workingUri,
			title: 'Current',
			detail: ' Working Tree',
		};

		const headUri = await svc.getBestRevisionUri(file.path, 'HEAD');
		if (headUri != null) {
			const branch = await svc.branches.getBranch?.();

			input2.uri = headUri;
			input2.detail = ` ${branch?.name || 'HEAD'}`;
		}

		const mergeBase = getSettledValue(mergeBaseResult);
		const baseUri = mergeBase != null ? await svc.getBestRevisionUri(file.path, mergeBase) : undefined;

		return openMergeEditor({
			base: baseUri ?? nodeUri,
			input1: input1,
			input2: input2,
			output: workingUri,
		});
	}

	@command('gitlens.diffWithRevision:')
	@debug()
	private diffWithRevision(item: DetailsItemContext | undefined) {
		if (!isDetailsFileContext(item)) return;

		const uri = getUriFromContext(this.container, item.webviewItemValue);
		if (uri == null) return;

		void executeCommand('gitlens.diffWithRevision', uri);
	}

	@command('gitlens.diffWithRevisionFrom:')
	@debug()
	private diffWithRevisionFrom(item: DetailsItemContext | undefined) {
		if (!isDetailsFileContext(item)) return;

		const uri = getUriFromContext(this.container, item.webviewItemValue);
		if (uri == null) return;

		void executeCommand('gitlens.diffWithRevisionFrom', uri);
	}

	@command('gitlens.externalDiff:')
	@debug()
	private async externalDiff(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		const previousSha = await commit.getPreviousSha();
		const ref1 = isUncommitted(previousSha) ? '' : previousSha;
		const ref2 = commit.isUncommitted ? '' : commit.sha;

		void executeCommand('gitlens.externalDiff', {
			files: [{ uri: file.uri, staged: commit.isUncommittedStaged, ref1: ref1, ref2: ref2 }],
		});
	}

	@command('gitlens.views.highlightChanges:')
	@debug()
	private async highlightChanges(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		this.suspendLineTracker();
		await openFile(file, commit, { preserveFocus: true, preview: true });
		void (await this.container.fileAnnotations.toggle(
			window.activeTextEditor,
			'changes',
			{ sha: commit.ref },
			true,
		));
	}

	@command('gitlens.views.highlightRevisionChanges:')
	@debug()
	private async highlightRevisionChanges(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		this.suspendLineTracker();
		await openFile(file, commit, { preserveFocus: true, preview: true });
		void (await this.container.fileAnnotations.toggle(
			window.activeTextEditor,
			'changes',
			{ sha: commit.ref, only: true },
			true,
		));
	}

	@command('gitlens.copyDeepLinkToCommit:')
	@debug()
	private async copyDeepLinkToCommit(item: DetailsItemContext | undefined) {
		const [commit] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand<CopyDeepLinkCommandArgs>('gitlens.copyDeepLinkToCommit', { refOrRepoPath: commit });
	}

	@command('gitlens.copyDeepLinkToFile:')
	@debug()
	private async copyDeepLinkToFile(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand<CopyFileDeepLinkCommandArgs>('gitlens.copyDeepLinkToFile', {
			ref: commit,
			filePath: file.path,
			repoPath: commit.repoPath,
		});
	}

	@command('gitlens.copyDeepLinkToFileAtRevision:')
	@debug()
	private async copyDeepLinkToFileAtRevision(item: DetailsItemContext | undefined) {
		const [commit, file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand<CopyFileDeepLinkCommandArgs>('gitlens.copyDeepLinkToFileAtRevision', {
			ref: commit,
			filePath: file.path,
			repoPath: commit.repoPath,
			chooseRef: true,
		});
	}

	@command('gitlens.views.copyRemoteCommitUrl:')
	@debug()
	private async copyRemoteCommitUrl(item: DetailsItemContext | undefined) {
		const [commit] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand<OpenOnRemoteCommandArgs>('gitlens.openOnRemote', {
			repoPath: commit.repoPath,
			resource: { type: RemoteResourceType.Commit, sha: commit.ref },
			clipboard: true,
		});
	}

	@command('gitlens.shareAsCloudPatch:')
	@debug()
	private async shareAsCloudPatch(item: DetailsItemContext | undefined) {
		const [commit] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		if (commit.message == null) {
			await commit.ensureFullDetails();
		}

		const { summary: title, body: description } = splitCommitMessage(commit.message);

		void executeCommand<CreatePatchCommandArgs>('gitlens.createCloudPatch', {
			to: commit.ref,
			repoPath: commit.repoPath,
			title: title,
			description: description,
		});
	}

	@command('gitlens.copyRemoteFileUrlFrom:')
	@debug()
	private async copyRemoteFileUrlFrom(item: DetailsItemContext | undefined) {
		const [commit, _file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand<OpenFileOnRemoteCommandArgs>('gitlens.copyRemoteFileUrlFrom', {
			sha: commit.ref,
			clipboard: true,
			pickBranchOrTag: true,
			range: false,
		});
	}

	@command('gitlens.copyRemoteFileUrlWithoutRange:')
	@debug()
	private async copyRemoteFileUrlWithoutRange(item: DetailsItemContext | undefined) {
		const [commit, _file] = await this.getFileCommitFromContextOrParams(item);
		if (commit == null) return;

		void executeCommand<OpenFileOnRemoteCommandArgs>('gitlens.copyRemoteFileUrlWithoutRange', {
			sha: commit.ref,
			clipboard: true,
			range: false,
		});
	}
}

// async function summaryModel(commit: GitCommit): Promise<CommitSummary> {
// 	return {
// 		sha: commit.sha,
// 		shortSha: commit.shortSha,
// 		summary: commit.summary,
// 		message: commit.message,
// 		author: commit.author,
// 		avatar: (await commit.getAvatarUri())?.toString(true),
// 	};
// }

function serializeSignature(signature: CommitSignature): CommitSignatureShape {
	return {
		status: signature.status,
		format: signature.format,
		signer: signature.signer,
		keyId: signature.keyId,
		fingerprint: signature.fingerprint,
		trustLevel: signature.trustLevel,
		errorMessage: signature.errorMessage,
	};
}

function serializeBranch(branch?: GitBranch): GitBranchShape | undefined {
	if (branch == null) return undefined;

	return {
		name: branch.name,
		repoPath: branch.repoPath,
		upstream: branch.upstream,
		tracking: {
			ahead: branch.upstream?.state.ahead ?? 0,
			behind: branch.upstream?.state.behind ?? 0,
		},
	};
}

function serializeWipContext(wip?: WipContext): Wip | undefined {
	if (wip == null) return undefined;

	return {
		changes: wip.changes,
		repositoryCount: wip.repositoryCount,
		branch: serializeBranch(wip.branch),
		repo: {
			uri: wip.repo.uri.toString(),
			name: wip.repo.name,
			path: wip.repo.path,
			// type: wip.repo.provider.name,
		},
		pullRequest: wip.pullRequest != null ? serializePullRequest(wip.pullRequest) : undefined,
		codeSuggestions: wip.codeSuggestions?.map(draft => ({
			...draft,
			changesets: undefined, // Inspect doesn't need changesets for the draft list
		})),
	};
}
