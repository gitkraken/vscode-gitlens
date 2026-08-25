/*global*/
import './patchDetails.scss';
import type { Remote, Subscription } from '@eamodio/supertalk';
import { subscribe } from '@eamodio/supertalk';
import { html } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { fromBase64ToString } from '@gitlens/utils/base64.js';
import { debounce } from '@gitlens/utils/debounce.js';
import type { ViewFilesLayout } from '../../../../config.js';
import type { DraftVisibility } from '../../../../plus/drafts/models/drafts.js';
import type { Serialized } from '../../../../system/serialize.js';
import type {
	DidExplainParams,
	ExecuteFileActionParams,
	Mode,
	State,
	SwitchModeParams,
} from '../../../plus/patchDetails/protocol.js';
import type {
	PatchDetailsCreateChangedEvent,
	PatchDetailsDraftChangedEvent,
	PatchDetailsPatchRepositoryChangedEvent,
	PatchDetailsPreferencesChangedEvent,
	PatchDetailsServices,
	PatchDetailsStateChangedEvent,
	PatchDetailsViewService,
} from '../../../rpc/patchDetailsService.js';
import { SeedBuffer } from '../../shared/actions/seedBuffer.js';
import { SignalWatcherWebviewApp } from '../../shared/appBase.js';
import { DOM } from '../../shared/dom.js';
import type { Disposable } from '../../shared/events.js';
import { subscribeAll } from '../../shared/events/subscriptions.js';
import { getHost } from '../../shared/host/context.js';
import { RpcController } from '../../shared/rpc/rpcController.js';
import { createSignalGroup } from '../../shared/state/signals.js';
import type {
	ApplyPatchDetail,
	DraftReasonEventDetail,
	GlDraftDetails,
	PatchCheckedDetail,
	PatchDetailsUpdateSelectionEventDetail,
} from './components/gl-draft-details.js';
import type {
	CreatePatchCheckRepositoryEventDetail,
	CreatePatchEventDetail,
	CreatePatchMetadataEventDetail,
	CreatePatchUpdateSelectionEventDetail,
	GlPatchCreate,
} from './components/gl-patch-create.js';
import type { GlPatchDetailsApp, ShowPatchInGraphDetail } from './components/patch-details-app.js';
import './components/patch-details-app.js';

function createPatchDetailsAppState() {
	const { signal, resetAll } = createSignalGroup();

	return {
		/** Complete webview state — seeded from the bootstrap, then updated by the host's slice events. */
		state: signal<Serialized<State> | undefined>(undefined),

		resetAll: resetAll,
	};
}

/** File-change event detail shared by the create and details file trees. */
export type FileChangeListItemDetail = ExecuteFileActionParams;

@customElement('gl-patch-details-root')
export class PatchDetailsApp extends SignalWatcherWebviewApp {
	@property({ type: String, noAccessor: true })
	private context!: string;

	private _host = getHost();

	/** Instance-owned ephemeral state — reseeded from the bootstrap on every mount. */
	private readonly _state = createPatchDetailsAppState();

	/**
	 * RPC event subscription — released at disconnect (the subscriber closes over this mount's
	 * state) and recreated per ready against the new session.
	 */
	private _eventsSubscription?: Subscription;

	/** Buffers event applications while the subscribe-then-query seed is in flight — see {@link SeedBuffer}. */
	private readonly _seedBuffer = new SeedBuffer();

	/** The resolved view-specific service — set per ready; UI handlers are no-ops before then. */
	private _patchDetails?: Awaited<Remote<PatchDetailsServices>['patchDetails']>;

	private _commands?: Awaited<Remote<PatchDetailsServices>['commands']>;

	/** In-flight AI request abort controllers — a new request supersedes the previous one. */
	private _explainAbort?: AbortController;
	private _generateAbort?: AbortController;

	protected override readonly _rpc = new RpcController<PatchDetailsServices>(this, {
		rpcOptions: {
			webviewId: () => this._webview?.webviewId,
			webviewInstanceId: () => this._webview?.webviewInstanceId,
			endpoint: () => this._host.createEndpoint(),
		},
		onReady: services => this._onRpcReady(services),
	});

	override connectedCallback(): void {
		super.connectedCallback?.();

		const context = this.consumeOneShotAttribute(this.context);
		this.context = undefined!;
		this.initWebviewContext(context);

		// Document-delegated component events — the same wiring the legacy app had in onBind()
		this.disposables.push(...this.bindDomEvents());

		// Seed all state from the bootstrap — a complete snapshot the host regenerates on every mount
		const metadata = JSON.parse(fromBase64ToString(context)) as Serialized<State>;
		this._state.state.set(metadata);
	}

	override disconnectedCallback(): void {
		// Unsubscribe before resetting state: the retained handle would otherwise re-issue its
		// subscriber — which closes over the reset state — on the next handshake. A fresh
		// subscription is created per ready anyway, so nothing is lost by releasing it here.
		this._eventsSubscription?.unsubscribe();
		this._eventsSubscription = undefined;
		this._patchDetails = undefined;
		this._commands = undefined;
		// A seed still in flight belongs to this mount's buffer; stranding it here means its
		// deferred applications must not touch the next mount.
		this._seedBuffer.reset();

		this._explainAbort?.abort();
		this._explainAbort = undefined;
		this._generateAbort?.abort();
		this._generateAbort = undefined;

		this._state.resetAll();

		super.disconnectedCallback?.();
	}

	protected override firstUpdated(): void {
		this.attachState();
	}

	private async _onRpcReady(services: Remote<PatchDetailsServices>): Promise<void> {
		const [commands, patchDetails] = await Promise.all([services.commands, services.patchDetails]);
		this._commands = commands;
		this._patchDetails = patchDetails;

		this._promos.connect(this._rpc.connection!);

		// Subscribe to events FIRST so changes during startup aren't missed — synchronous:
		// `subscribe()` buffers the wire subscribe until the connection's handshake completes.
		// Recreated per ready (not `??=`): the subscriber closes over this mount's state.
		this._eventsSubscription?.unsubscribe();
		this._eventsSubscription = subscribe<PatchDetailsServices>(this._rpc.connection!, async remoteServices => {
			const svc = await remoteServices.patchDetails;

			return subscribeAll([
				() =>
					svc.onStateChanged(state => {
						this.onStateChanged(state);
					}),
				() =>
					svc.onCreateChanged(event => {
						this.onCreateChanged(event.mode, event.create);
					}),
				() =>
					svc.onDraftChanged(event => {
						this.onDraftChanged(event.mode, event.draft);
					}),
				() =>
					svc.onPreferencesChanged(event => {
						this.onPreferencesChanged(event.preferences);
					}),
				() =>
					svc.onPatchRepositoryChanged(event => {
						this.onPatchRepositoryChanged(event.patch);
					}),
			]);
		});

		// Subscribe-then-query seed: pushes emitted before this element generation die with the
		// old session (save-last buffers only for connected subscribers), and the one-shot
		// bootstrap attribute can be stale after an in-place remount — fetch the authoritative
		// snapshot now that events are armed so nothing is missed. The query awaits repository
		// work, so slice events can land while it is pending; those are buffered (starting now,
		// since even pre-query events may be newer than the snapshot) and replayed AFTER the
		// snapshot — guaranteeing the final state reflects every event in order instead of
		// racing the response.
		this._seedBuffer.start();
		await this._eventsSubscription.ready;
		const state = await patchDetails.getState();
		// This mount may have torn down while the query was pending — a dead seed must not
		// apply (or drain) anything into whatever replaced it.
		if (this._patchDetails !== patchDetails) return;

		// Apply the snapshot DIRECTLY (not via onStateChanged/the seed buffer): events buffered
		// while it was pending are newer than it, and replaying them after the direct apply is
		// what converges state — routing the seed through the buffer would order the older
		// snapshot last and clobber them.
		this.setState(state);
		this._seedBuffer.drain();
	}

	// ------------------------------------------------------------------
	// Host event handling — each event updates its own slice of state,
	// last write wins. This replaces the legacy "a reset-flagged full push
	// clears queued partials" invariant: a full snapshot simply overwrites
	// every slice at once.
	// ------------------------------------------------------------------

	private onStateChanged(state: PatchDetailsStateChangedEvent): void {
		this._seedBuffer.during(() => this.setState(state));
	}

	private onCreateChanged(mode: Mode, create: PatchDetailsCreateChangedEvent['create']): void {
		this._seedBuffer.during(() => this.setState({ ...this.getState(), mode: mode, create: create }));
	}

	private onDraftChanged(mode: Mode, draft: PatchDetailsDraftChangedEvent['draft']): void {
		this._seedBuffer.during(() => this.setState({ ...this.getState(), mode: mode, draft: draft }));
	}

	private onPreferencesChanged(preferences: PatchDetailsPreferencesChangedEvent['preferences']): void {
		this._seedBuffer.during(() => this.setState({ ...this.getState(), preferences: preferences }));
	}

	private onPatchRepositoryChanged(patch: PatchDetailsPatchRepositoryChangedEvent['patch']): void {
		this._seedBuffer.during(() => {
			const state = this.getState();
			const patches = state.draft?.patches;
			if (patches == null) return;

			const patchIndex = patches.findIndex(p => p.id === patch.id);
			if (patchIndex === -1) return;

			patches.splice(patchIndex, 1, patch);

			// Pass a fresh top-level object: both the signal and the component property short-circuit
			// on reference equality, so re-passing the same object would skip the repaint entirely.
			this.setState({ ...state });
		});
	}

	private getState(): Serialized<State> {
		return this._state.state.get()!;
	}

	private setState(state: Serialized<State>): void {
		this._state.state.set(state);
		this.debouncedAttachState();
	}

	// ------------------------------------------------------------------
	// Component wiring — components stay IPC/RPC-free and communicate via
	// their DOM CustomEvents (document-delegated), exactly as before.
	// ------------------------------------------------------------------

	private bindDomEvents(): Disposable[] {
		return [
			DOM.on('[data-switch-value]', 'click', e => this.onToggleFilesLayout(e)),
			DOM.on('[data-action="ai-explain"]', 'click', e => this.onAIExplain(e)),
			DOM.on('[data-action="switch-ai"]', 'click', e => this.onSwitchAIModel(e)),
			DOM.on('[data-action="mode"]', 'click', e => this.onModeClicked(e)),
			DOM.on<GlDraftDetails, ApplyPatchDetail>('gl-draft-details', 'gl-patch-apply-patch', e =>
				this.onApplyPatch(e.detail),
			),
			DOM.on<GlDraftDetails, DraftReasonEventDetail>('gl-draft-details', 'gl-draft-archive', e =>
				this.onArchiveDraft(e.detail.reason),
			),
			DOM.on<GlPatchDetailsApp, ShowPatchInGraphDetail>(
				'gl-patch-details-app',
				'gl-patch-details-graph-show-patch',
				e => this.onShowPatchInGraph(e.detail),
			),
			DOM.on<GlPatchDetailsApp, CreatePatchEventDetail>('gl-patch-details-app', 'gl-patch-create-patch', e =>
				this.onCreatePatch(e.detail),
			),
			DOM.on<GlDraftDetails, undefined>('gl-draft-details', 'gl-patch-details-copy-cloud-link', () =>
				this.onCopyCloudLink(),
			),
			DOM.on<GlPatchCreate, undefined>('gl-patch-create', 'gl-patch-create-invite-users', () =>
				this.onInviteUsers(),
			),
			DOM.on<GlDraftDetails, undefined>('gl-draft-details', 'gl-patch-details-invite-users', () =>
				this.onInviteUsers(),
			),
			DOM.on<GlPatchCreate, CreatePatchUpdateSelectionEventDetail>(
				'gl-patch-create',
				'gl-patch-create-update-selection',
				e => this.onUpdateUserSelection(e.detail),
			),
			DOM.on<GlDraftDetails, PatchDetailsUpdateSelectionEventDetail>(
				'gl-draft-details',
				'gl-patch-details-update-selection',
				e => this.onUpdateUserSelection(e.detail),
			),
			DOM.on<GlPatchCreate, CreatePatchCheckRepositoryEventDetail>(
				'gl-patch-create',
				'gl-patch-create-repo-checked',
				e => this.onCreateCheckRepo(e.detail),
			),
			DOM.on<GlPatchCreate, CreatePatchMetadataEventDetail>('gl-patch-create', 'gl-patch-generate-title', e =>
				this.onCreateGenerateTitle(e.detail),
			),
			DOM.on<GlPatchCreate, CreatePatchMetadataEventDetail>(
				'gl-patch-create',
				'gl-patch-create-update-metadata',
				e => this.onCreateUpdateMetadata(e.detail),
			),
			DOM.on<GlDraftDetails, { visibility: DraftVisibility }>(
				'gl-draft-details',
				'gl-patch-details-update-metadata',
				e => this.onDraftUpdateMetadata(e.detail),
			),
			DOM.on<GlDraftDetails, undefined>('gl-draft-details', 'gl-patch-details-update-permissions', () =>
				this.onDraftUpdatePermissions(),
			),
			DOM.on<GlPatchCreate, FileChangeListItemDetail>(
				'gl-patch-create,gl-draft-details',
				'gl-patch-file-compare-previous',
				e => this.onCompareFileWithPrevious(e.detail),
			),
			DOM.on<GlPatchCreate, FileChangeListItemDetail>(
				'gl-patch-create,gl-draft-details',
				'gl-patch-file-compare-working',
				e => this.onCompareFileWithWorking(e.detail),
			),
			DOM.on<GlDraftDetails, FileChangeListItemDetail>(
				'gl-patch-create,gl-draft-details',
				'gl-patch-file-open',
				e => this.onOpenFile(e.detail),
			),
			DOM.on<GlDraftDetails, PatchCheckedDetail>('gl-draft-details', 'gl-patch-checked', e =>
				this.onPatchChecked(e.detail),
			),
		];
	}

	private get patchDetails(): PatchDetailsViewService | undefined {
		return this._patchDetails;
	}

	private onPatchChecked(e: PatchCheckedDetail) {
		void this.patchDetails?.patchChecked(e);
	}

	private onCreateCheckRepo(e: CreatePatchCheckRepositoryEventDetail) {
		void this.patchDetails?.updateCreateCheckedState(e);
	}

	private onCreateUpdateMetadata(e: CreatePatchMetadataEventDetail) {
		void this.patchDetails?.updateCreateMetadata(e);
	}

	private async onCreateGenerateTitle(_e: CreatePatchMetadataEventDetail): Promise<void> {
		const svc = this.patchDetails;
		if (svc == null) return;

		// Supersede any in-flight generation; its (stale) result is dropped below — without this
		// a double-click's superseded rejection would flash a bogus error over the valid title.
		this._generateAbort?.abort();
		const controller = new AbortController();
		this._generateAbort = controller;

		try {
			const result = await svc.generate(controller.signal);
			if (controller.signal.aborted) return;

			if (result.error) {
				this.component.generate = { error: { message: result.error.message ?? 'Error retrieving content' } };
			} else if (result.title || result.description) {
				this.component.generate = {
					title: result.title,
					description: result.description,
				};

				const state = this.getState();
				this.setState({
					...state,
					create: {
						...state.create!,
						title: result.title ?? state.create?.title,
						description: result.description ?? state.create?.description,
					},
				});
			} else {
				this.component.generate = undefined;
			}
		} catch (_ex) {
			if (controller.signal.aborted) return;

			this.component.generate = { error: { message: 'Error retrieving content' } };
		}
	}

	private onDraftUpdateMetadata(e: { visibility: DraftVisibility }) {
		void this.patchDetails?.updateDraftMetadata(e);
	}

	private onDraftUpdatePermissions() {
		void this.patchDetails?.updateDraftPermissions();
	}

	// No-op today (matches the legacy app): the graph-show-patch flow was never wired to a command
	private onShowPatchInGraph(_e: ShowPatchInGraphDetail) {
		// this.patchDetails?.openInCommitGraph({ repoPath: '', ref: '' });
	}

	private onCreatePatch(e: CreatePatchEventDetail) {
		void this.patchDetails?.createDraft(e);
	}

	private onCopyCloudLink() {
		void this.patchDetails?.copyCloudLink();
	}

	private onModeClicked(e: Event) {
		const mode = ((e.target as HTMLElement)?.dataset.actionValue as SwitchModeParams['mode']) ?? undefined;
		if (mode === this.getState().mode) return;

		void this.patchDetails?.switchMode({ mode: mode });
	}

	private onApplyPatch(e: ApplyPatchDetail) {
		if (e.selectedPatches == null || e.selectedPatches.length === 0) return;

		void this.patchDetails?.applyPatch({
			details: e.draft,
			target: e.target ?? 'current',
			selected: e.selectedPatches,
		});
	}

	private onArchiveDraft(reason?: DraftReasonEventDetail['reason']) {
		void this.patchDetails?.archiveDraft({ reason: reason });
	}

	private onSwitchAIModel(_e: MouseEvent) {
		const commands = this._commands;
		if (commands == null) return;

		void commands.execute('gitlens.ai.switchProvider');
	}

	/** Generates title/description for the create form — a new request supersedes an in-flight one. */
	private async onAIExplain(_e: MouseEvent): Promise<void> {
		const svc = this.patchDetails;
		if (svc == null) return;

		// Supersede any in-flight explanation; its (stale) result is dropped below
		this._explainAbort?.abort();
		const controller = new AbortController();
		this._explainAbort = controller;

		try {
			const result: DidExplainParams = await svc.explain(controller.signal);
			if (controller.signal.aborted) return;

			if (result.error) {
				this.component.explain = { error: { message: result.error.message ?? 'Error retrieving content' } };
			} else {
				this.component.explain = result;
			}
		} catch (_ex) {
			if (controller.signal.aborted) return;

			this.component.explain = { error: { message: 'Error retrieving content' } };
		}
	}

	private onToggleFilesLayout(e: MouseEvent) {
		const layout = ((e.target as HTMLElement)?.dataset.switchValue as ViewFilesLayout) ?? undefined;
		const state = this.getState();
		if (layout === state.preferences.files?.layout) return;

		const files: State['preferences']['files'] = {
			...state.preferences.files,
			layout: layout ?? 'auto',
			compact: state.preferences.files?.compact ?? true,
			threshold: state.preferences.files?.threshold ?? 5,
			icon: state.preferences.files?.icon ?? 'type',
		};

		this.setState({ ...state, preferences: { ...state.preferences, files: files } });

		void this.patchDetails?.updatePreferences({ files: files });
	}

	private onInviteUsers() {
		void this.patchDetails?.inviteUsers();
	}

	private onUpdateUserSelection(e: CreatePatchUpdateSelectionEventDetail | PatchDetailsUpdateSelectionEventDetail) {
		void this.patchDetails?.updateUserSelection(e);
	}

	private onOpenFile(e: FileChangeListItemDetail) {
		void this.patchDetails?.openFile(e);
	}

	private onCompareFileWithWorking(e: FileChangeListItemDetail) {
		void this.patchDetails?.openFileComparisonWithWorking(e);
	}

	private onCompareFileWithPrevious(e: FileChangeListItemDetail) {
		void this.patchDetails?.openFileComparisonWithPrevious(e);
	}

	override render(): unknown {
		return html`<gl-patch-details-app id="app"></gl-patch-details-app>`;
	}

	protected override createRenderRoot(): HTMLElement {
		// Light DOM — the components assume document-level event delegation (`DOM.on` selectors)
		// and the global styles from the imported scss.
		return this;
	}

	private _component?: GlPatchDetailsApp;
	private get component(): GlPatchDetailsApp {
		if (this._component == null) {
			this._component = (document.getElementById('app') as GlPatchDetailsApp)!;
			this._component.app = this;
		}
		return this._component;
	}

	private attachState() {
		const state = this._state.state.get();
		if (state != null) {
			this.component.state = state;
		}
	}
	private debouncedAttachState = debounce(this.attachState.bind(this), 100);
}
