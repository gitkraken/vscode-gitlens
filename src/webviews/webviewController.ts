import type { Event, ViewBadge, Webview, WebviewPanel, WebviewView, WindowState } from 'vscode';
import { CancellationTokenSource, Disposable, EventEmitter, Uri, ViewColumn, window, workspace } from 'vscode';
import { base64 } from '@gitlens/utils/base64.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { getNonce } from '@gitlens/utils/crypto.js';
import { logName, trace } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { maybeStopWatch, Stopwatch } from '@gitlens/utils/stopwatch.js';
import type { GlWebviewCommands } from '../constants.commands.js';
import type {
	Source,
	TelemetryEvents,
	WebviewTelemetryContext,
	WebviewTelemetryEvents,
} from '../constants.telemetry.js';
import type {
	CustomEditorIds,
	CustomEditorTypes,
	WebviewIds,
	WebviewPanelIds,
	WebviewPanelTypes,
	WebviewTypeFromId,
	WebviewViewIds,
	WebviewViewTypes,
} from '../constants.views.js';
import type { Container } from '../container.js';
import { executeCommand, executeCoreCommand } from '../system/-webview/command.js';
import {
	includesContextDelimitedString,
	removeFromContextDelimitedString,
	setContext,
} from '../system/-webview/context.js';
import { getViewFocusCommand } from '../system/-webview/vscode/views.js';
import { serializeIpcData } from '../system/ipcSerialize.js';
import type { WebviewContext } from '../system/webview.js';
import type { WebviewState } from './protocol.js';
import { EventVisibilityBuffer, SubscriptionTracker } from './rpc/eventVisibilityBuffer.js';
import { RpcHost } from './rpc/rpcHost.js';
import { disposeServices } from './rpc/services/proxy.js';
import type { WebviewClientConnectParams } from './rpc/webviewViewService.js';
import type { WebviewCommandCallback, WebviewCommandRegistrar } from './webviewCommandRegistrar.js';
import type { CustomEditorDescriptor, WebviewPanelDescriptor, WebviewViewDescriptor } from './webviewDescriptors.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from './webviewProvider.js';
import type { WebviewShowOptions } from './webviewsController.js';

type GetWebviewDescriptor<T extends CustomEditorIds | WebviewIds> = T extends CustomEditorIds
	? CustomEditorDescriptor<T>
	: T extends WebviewPanelIds
		? WebviewPanelDescriptor<T>
		: T extends WebviewViewIds
			? WebviewViewDescriptor<T>
			: never;

type GetWebviewParent<T extends CustomEditorIds | WebviewIds> = T extends WebviewViewIds ? WebviewView : WebviewPanel;

const utf8Decoder = new TextDecoder();

@logName(c => `WebviewController(${c.id}${c.instanceId != null ? `|${c.instanceId}` : ''})`)
export class WebviewController<
	ID extends CustomEditorIds | WebviewIds,
	State,
	SerializedState = State,
	ShowingArgs extends unknown[] = unknown[],
>
	implements WebviewHost<ID>, Disposable
{
	static async create<
		ID extends WebviewPanelIds,
		State,
		SerializedState = State,
		ShowingArgs extends unknown[] = unknown[],
	>(
		container: Container,
		commandRegistrar: WebviewCommandRegistrar,
		descriptor: WebviewPanelDescriptor<ID>,
		instanceId: string,
		parent: WebviewPanel,
		resolveProvider: (
			container: Container,
			host: WebviewHost<ID>,
		) => Promise<WebviewProvider<State, SerializedState, ShowingArgs>>,
	): Promise<WebviewController<ID, State, SerializedState, ShowingArgs>>;
	static async create<
		ID extends WebviewViewIds,
		State,
		SerializedState = State,
		ShowingArgs extends unknown[] = unknown[],
	>(
		container: Container,
		commandRegistrar: WebviewCommandRegistrar,
		descriptor: WebviewViewDescriptor<ID>,
		instanceId: string,
		parent: WebviewView,
		resolveProvider: (
			container: Container,
			host: WebviewHost<ID>,
		) => Promise<WebviewProvider<State, SerializedState, ShowingArgs>>,
	): Promise<WebviewController<ID, State, SerializedState, ShowingArgs>>;
	static async create<
		ID extends CustomEditorIds,
		State,
		SerializedState = State,
		ShowingArgs extends unknown[] = unknown[],
	>(
		container: Container,
		commandRegistrar: WebviewCommandRegistrar,
		// oxlint-disable-next-line typescript/unified-signatures
		descriptor: CustomEditorDescriptor<ID>,
		instanceId: string,
		parent: WebviewPanel,
		resolveProvider: (
			container: Container,
			host: WebviewHost<ID>,
		) => Promise<WebviewProvider<State, SerializedState, ShowingArgs>>,
	): Promise<WebviewController<ID, State, SerializedState, ShowingArgs>>;
	static async create<
		ID extends CustomEditorIds | WebviewIds,
		State,
		SerializedState = State,
		ShowingArgs extends unknown[] = unknown[],
	>(
		container: Container,
		commandRegistrar: WebviewCommandRegistrar,
		descriptor: GetWebviewDescriptor<ID>,
		instanceId: string,
		parent: GetWebviewParent<ID>,
		resolveProvider: (
			container: Container,
			host: WebviewHost<ID>,
		) => Promise<WebviewProvider<State, SerializedState, ShowingArgs>>,
	): Promise<WebviewController<ID, State, SerializedState, ShowingArgs>> {
		const controller = new WebviewController<ID, State, SerializedState, ShowingArgs>(
			container,
			commandRegistrar,
			descriptor,
			instanceId,
			parent,
			resolveProvider,
		);
		await controller.initialize();
		return controller;
	}

	private readonly _onDidDispose = new EventEmitter<void>();
	get onDidDispose(): Event<void> {
		return this._onDidDispose.event;
	}

	/** Visibility pushes for the RPC `webview` service (`onVisibilityChanged`). */
	private readonly _onDidChangeVisibility = new EventEmitter<boolean>();
	get onDidChangeVisibility(): Event<boolean> {
		return this._onDidChangeVisibility.event;
	}

	/** Webview focus pushes for the RPC `webview` service (`onWebviewFocusChanged`). */
	private readonly _onDidChangeFocus = new EventEmitter<boolean>();
	get onDidChangeFocus(): Event<boolean> {
		return this._onDidChangeFocus.event;
	}

	/** Host-window focus pushes for the RPC `webview` service (`onHostWindowFocusChanged`). */
	private readonly _onDidChangeWindowFocus = new EventEmitter<boolean>();
	get onDidChangeWindowFocus(): Event<boolean> {
		return this._onDidChangeWindowFocus.event;
	}

	readonly id: ID;

	get type(): WebviewTypeFromId<ID> {
		return this.descriptor.type as WebviewTypeFromId<ID>;
	}

	private _ready: boolean = false;
	get ready(): boolean {
		return this._ready;
	}

	private _readyCount = 0;
	private _lastHtmlSetAt: number | undefined;

	/**
	 * Refresh coalescing: `refresh(force=true)` tears down the iframe and re-renders the HTML, which is
	 * destructive while the iframe is mid-render. Coalesce in-flight calls and drop rapid back-to-back
	 * calls within {@link refreshCoalesceMs} of the previous refresh completing.
	 */
	private static readonly refreshCoalesceMs = 1000;
	private _refreshing: Promise<void> | undefined;
	private _lastRefreshCompletedAt = 0;

	/** Used to cancel pending ipc promise operations */
	private cancellation: CancellationTokenSource | undefined;
	private disposable: Disposable | undefined;
	private _isInEditor: boolean;
	private /*readonly*/ provider!: WebviewProvider<State, SerializedState, ShowingArgs>;
	private _eventBuffer: EventVisibilityBuffer | undefined;
	private _rpcHost: RpcHost<object> | undefined;
	/** Held so {@link connect} can attribute registrations to the validating client's caller
	 *  session and release every other session's — see {@link SubscriptionTracker.releaseAllExcept}. */
	private _tracker: SubscriptionTracker | undefined;
	/** Generation guard: identifies the iframe generation (a client session's `clientId`, reported
	 * via the RPC `webview.connect()` handshake) most recently granted RPC exposure, and the
	 * `clientLoadedAt` it was stamped with. A connect is only ever classified as a reconnect based
	 * on `_ready` (a boolean), which can't distinguish "the current live iframe checking in again"
	 * from "a late-arriving/duplicate connect from an iframe generation that's already been
	 * superseded by a later reload". Comparing `clientLoadedAt` (not just `clientId` difference)
	 * lets a genuinely newer reconnect still supersede us normally, while a straggler from an older
	 * generation gets dropped before it can re-run reconnect handling.
	 */
	private _activeClientId: string | undefined;
	private _activeClientLoadedAt: number | undefined;

	/** Session-validation state, gating connection swaps in {@link RpcHost}:
	 *
	 * - `none` — no session has been validated since the last invalidation (dispose, html apply,
	 *   non-retain hide); an announcement is a fresh generation and must be served.
	 * - `served-awaiting-validation` — an announcement was JUST served but its `connect()` hasn't
	 *   completed yet. This gate itself doesn't inspect identity, so any further announcement in
	 *   this window is ignored outright — swapping again would destroy the just-served session's
	 *   transport. `connect()` is where identity is actually checked, against `RpcHost`'s recorded
	 *   `pendingServedSession` (see there).
	 * - `healthy` — a `connect()` completed with the active generation; announcements are
	 *   duplicates or stale arrivals (e.g. the same iframe remounting its element), and the live
	 *   session must not be disturbed — the re-announce fallback lets any genuine waiter join.
	 *
	 * Swapping resets tracked subscriptions and severs the swapped-out session's event delivery,
	 * which is why every non-serving path re-announces instead. */
	private _sessionState: 'none' | 'served-awaiting-validation' | 'healthy' = 'none';

	/** When {@link _sessionState} entered `served-awaiting-validation`; lets the gate self-heal if
	 *  the served generation dies before its `connect()` arrives (otherwise the latch would fold
	 *  every later genuine generation into the non-serving path forever). */
	private _sessionServedAt = 0;

	/** How long a `served-awaiting-validation` latch waits for its `connect()` before the gate
	 *  serves again. A real connect() lands within milliseconds; stragglers do too — this only
	 *  bounds the crash-before-connect corner. */
	private static readonly sessionLatchTimeout = 10_000;

	/** Single writer for every `_sessionState` → `none` transition (dispose, html reload, non-retain
	 *  hide). Also clears `RpcHost`'s `pendingServedSession` — otherwise a late `connect()` from the
	 *  client served just before this invalidation would still match it and could validate against
	 *  the now-invalidated controller (see `connect()`'s identity gate). */
	private invalidateSession(): void {
		this._sessionState = 'none';
		this._rpcHost?.invalidatePendingSession();
	}

	private readonly webview: Webview;

	private _viewColumn: ViewColumn | undefined;
	get viewColumn(): ViewColumn | undefined {
		return this._viewColumn;
	}

	private constructor(
		private readonly container: Container,
		private readonly _commandRegistrar: WebviewCommandRegistrar,
		private readonly descriptor: GetWebviewDescriptor<ID>,
		public readonly instanceId: string,
		public readonly parent: GetWebviewParent<ID>,
		resolveProvider: (
			container: Container,
			host: WebviewHost<ID>,
		) => Promise<WebviewProvider<State, SerializedState, ShowingArgs>>,
	) {
		this.id = descriptor.id as ID;
		this.webview = parent.webview;

		const isInEditor = 'onDidChangeViewState' in parent;
		this._isInEditor = isInEditor;
		this._viewColumn = isInEditor ? parent.viewColumn : undefined;
		this._originalTitle = descriptor.title;
		parent.title = descriptor.title;

		this._initializing = resolveProvider(container, this).then(provider => {
			this.provider = provider;
			if (this._disposed) {
				provider.dispose();
				return;
			}

			// Set up RPC services if the provider exposes them.
			// The RpcHost creates a Connection and exposes it as soon as the webview's session
			// announces itself over RPC (see `onClientSession` below).
			const eventBuffer = this.descriptor.webviewHostOptions?.retainContextWhenHidden
				? new EventVisibilityBuffer()
				: undefined;
			this._eventBuffer = eventBuffer;
			const tracker = new SubscriptionTracker();
			this._tracker = tracker;
			const rpcServices = this.provider.getRpcServices?.(eventBuffer, tracker);
			if (rpcServices != null) {
				try {
					this._rpcHost = new RpcHost(
						this.webview,
						rpcServices,
						{
							webviewId: this.id,
							webviewInstanceId: this.instanceId,
							handlers: this.provider.getRpcHandlers?.(),
							shouldServeSession: () =>
								this._sessionState === 'none' ||
								(this._sessionState === 'served-awaiting-validation' &&
									Date.now() - this._sessionServedAt > WebviewController.sessionLatchTimeout),
							onClientSession: () => {
								// The webview's RPC session announced itself — the successor of receiving
								// `WebviewReadyRequest`. Sync transport visibility first (the webview may be
								// booting while hidden — e.g. created in the background — and setVisible is
								// otherwise only called reactively), then lift the reload-window mute so the
								// announcing generation starts receiving frames.
								if (this._reloadMuted) {
									// Lifts the mute AND restores both transports' visibility in one step.
									this.setTransportsMuted(false);
								} else {
									this._rpcHost?.setVisible(this.visible);
								}
								// The hook fires only for SERVED announcements — latch the state so any
								// further announcement before this generation's `connect()` validates is
								// treated as a stale straggler rather than triggering another swap.
								this._sessionServedAt = Date.now();
								this._sessionState = 'served-awaiting-validation';
							},
						},
						tracker,
					);
					Logger.debug(`WebviewController(${this.id}): RPC host created, awaiting connect`);
				} catch (ex) {
					Logger.error(ex, `WebviewController(${this.id}): Failed to create RPC host`);
				}
			}

			this.disposable = Disposable.from(
				this._onDidDispose,
				window.onDidChangeWindowState(this.onWindowStateChanged, this),
				isInEditor
					? parent.onDidChangeViewState(({ webviewPanel }) => {
							const { visible, active, viewColumn } = webviewPanel;
							// Only treat a viewColumn change as a forceReload-worthy "move" if the webview was
							// already alive (`_ready`). During panel restoration the first view-state event is
							// the panel settling into its restored column — not a user move — and forcing a
							// reload there tears down the just-created iframe mid-bootstrap, cancelling the
							// deferred-rows delivery and leaving the Graph stuck on its loading spinner.
							this.onParentVisibilityChanged(
								visible,
								active,
								this._ready && this.viewColumn != null && this.viewColumn !== viewColumn,
							);
							this._viewColumn = viewColumn;
						})
					: parent.onDidChangeVisibility(() => this.onParentVisibilityChanged(this.visible, this.active)),
				parent.onDidDispose(this.onParentDisposed, this),
				...(this.provider.registerCommands?.() ?? []),
				this.provider,
				...(this._rpcHost != null ? [this._rpcHost] : []),
				// Service resources that must survive tracker.reset() (reconnection) are released
				// only here, at controller teardown — see proxyServices/disposeServices
				{ dispose: () => disposeServices(rpcServices) },
			);
		});
	}

	private async removePlusFeatureOverride() {
		if (!this.descriptor.plusFeature) {
			return;
		}

		if (includesContextDelimitedString('gitlens:plus:disabled:view:overrides', this.descriptor.id)) {
			const action = 'Enable Pro Features';
			void window
				.showInformationMessage(
					`${this.descriptor.title} was closed as Pro features have been disabled.`,
					action,
				)
				.then(selection => {
					if (selection === action) {
						void executeCommand('gitlens.plus.restore');
					}
				});
		}

		return removeFromContextDelimitedString('gitlens:plus:disabled:view:overrides', [this.descriptor.id]);
	}

	/** True while a `refreshCore` reload window is open (html reset → session announcement →
	 *  expose() swap) — the RPC transports are muted for the window, and reactive visibility syncs
	 *  must not un-mute them. */
	private _reloadMuted = false;

	/** Single writer for the reload-window mute and BOTH transports' visibility — the buffer and the
	 *  RPC endpoint must never disagree, and every mute set/lift must restore both together. */
	private setTransportsMuted(muted: boolean): void {
		this._reloadMuted = muted;
		const visible = muted ? false : this.visible;
		this._eventBuffer?.setVisible(visible);
		this._rpcHost?.setVisible(visible);
	}

	private _disposed: boolean = false;
	dispose(): void {
		this._disposed = true;
		this.cancellation?.cancel();
		this.cancellation?.dispose();
		resetContextKeys(this.descriptor.contextKeyPrefix);

		void this.removePlusFeatureOverride();

		this.provider?.onFocusChanged?.(false);
		this.provider?.onVisibilityChanged?.(false);

		this.sendTelemetryEvent(`${this.descriptor.type}/closed`, {});

		this._ready = false;
		this.invalidateSession();

		this._onDidDispose.fire();
		this.disposable?.dispose();
	}

	registerWebviewCommand<T extends Partial<WebviewContext>>(
		command: GlWebviewCommands,
		callback: WebviewCommandCallback<T>,
	): Disposable {
		return this._commandRegistrar.registerCommand(this.provider, this.id, this.instanceId, command, callback);
	}

	registerWebviewCommandForId<T extends Partial<WebviewContext>>(
		webviewId: string,
		command: GlWebviewCommands,
		callback: WebviewCommandCallback<T>,
	): Disposable {
		return this._commandRegistrar.registerCommand(this.provider, webviewId, this.instanceId, command, callback);
	}

	private _initializing: Promise<void> | undefined;
	private async initialize() {
		if (this._initializing == null) return;

		await this._initializing;
		this._initializing = undefined;
	}

	/**
	 * Marks the announcing client generation as ready — the RPC-native successor of the legacy
	 * `WebviewReadyRequest` handler. Invoked by the webview's `RpcController` over the shared
	 * `webview` service group immediately after each successful handshake.
	 *
	 * RPC exposure itself no longer waits for this call: the {@link RpcHost} swaps to a fresh
	 * exposed connection as soon as the session announces itself (see `onClientSession`), so
	 * unlike the legacy ready case there is no expose step here.
	 */
	connect(params: WebviewClientConnectParams): Promise<void> {
		// Attribution: this call is itself dispatched over RPC by the connecting client, so its
		// caller session IS that client's session — but only synchronously, at the top, before any
		// `await` (see `Connection.callerSession`'s doc comment). Capture it before anything else.
		const callerSession = this._tracker?.callerSession;

		this._readyCount++;
		const sinceLastHtmlSet = this._lastHtmlSetAt != null ? Date.now() - this._lastHtmlSetAt : -1;
		// A re-connect means the webview's iframe was reloaded under us (e.g., panel layout settle, window
		// reload restoring a serialized panel). The new iframe re-boots from the ORIGINAL bootstrap, which
		// is stale by then; convergence happens over RPC: the expose() swap in RpcHost cycles the connection
		// and the fresh handshake's subscribe-then-seed re-produces everything, with provider.onReconnect
		// covering anything outside that plane.
		const isReconnect = this._ready;
		Logger.info(
			`WebviewController(${this.id}|${this.instanceId}): webview.connect #${this._readyCount} (clientId=${params.clientId ?? '?'}, clientLoadedAt=${params.clientLoadedAt ?? '?'}, sinceLastHtmlSet=${sinceLastHtmlSet}ms, wasAlreadyReady=${this._ready}, parentVisible=${this.parent.visible})`,
		);

		// Released-session gate: a session already superseded or rejected (see
		// `SubscriptionTracker.isSessionReleased`) can still deliver a late `connect()` — e.g. the
		// pre-remount session's call, sent before its successor validated, dispatching after (the
		// host connection never reset, so nothing on the wire drops it). The gates below can't
		// catch it: the controller is healthy again by then, and it carries the SAME client
		// identity as its successor (same iframe), so the generation guard has nothing to compare.
		// Accepting it would supersede the LIVE session while the caller itself stays tombstoned —
		// releasing every usable registration and leaving the surface dead.
		if (this._tracker?.isSessionReleased(callerSession) === true) {
			Logger.debug(
				`WebviewController(${this.id}|${this.instanceId}): rejecting webview.connect #${this._readyCount} from a released session (session=${callerSession ?? '?'})`,
			);
			return Promise.resolve();
		}

		// Identity gate: while establishing or re-establishing the active client (not yet healthy),
		// only the session RpcHost actually SERVED may validate. Without this, whichever caller's
		// connect() call happens to land first would become "the" active client — including an
		// interloper whose announcement was ignored (see `RpcHost.armAnnouncementTap`) but who still
		// got a resolved handshake off the re-posted frame. A live-healthy client's own remount
		// skips this: its announcement is deliberately left unserved (see the same tap), so its
		// session never becomes the pending one — the clientId check below covers it instead.
		//
		// `none` rejects UNCONDITIONALLY, regardless of whether `callerSession` happens to match
		// `pendingServedSession` — that value is only meaningful during `served-awaiting-validation`;
		// once invalidated (`invalidateSession()` clears it too, belt-and-suspenders) nothing has
		// been served since, so no caller has anything legitimate to validate against. Without this,
		// a late call from the client served just before an html reload/dispose/hide could still
		// match a stale `pendingServedSession` and validate against the now-invalidated controller.
		const servedSessionValidated =
			this._sessionState === 'served-awaiting-validation' &&
			callerSession === this._rpcHost?.pendingServedSession;
		if (this._sessionState !== 'healthy' && !servedSessionValidated) {
			Logger.debug(
				`WebviewController(${this.id}|${this.instanceId}): rejecting webview.connect #${this._readyCount} from an unvalidated session (session=${callerSession ?? '?'}, sessionState=${this._sessionState})`,
			);
			this._tracker?.releaseSession(callerSession);
			return Promise.resolve();
		}

		// Generation guard: drop a connect from an iframe generation older than the one we've already
		// granted RPC exposure to — e.g. a late-arriving/duplicate announcement from an iframe already
		// superseded by a later reload. Without this, `isReconnect` above (driven solely by the `_ready`
		// boolean) can't tell that straggler apart from a legitimate reconnect, and would process it as
		// one. Compare by clientLoadedAt, not just clientId, so a genuinely newer reconnect (a later
		// reload of the same webview) still proceeds normally below.
		if (
			this._activeClientId != null &&
			params.clientId !== this._activeClientId &&
			this._activeClientLoadedAt != null &&
			params.clientLoadedAt != null &&
			params.clientLoadedAt <= this._activeClientLoadedAt
		) {
			Logger.debug(
				`WebviewController(${this.id}|${this.instanceId}): ignoring webview.connect #${this._readyCount} from a superseded generation (clientId=${params.clientId ?? '?'}, active=${this._activeClientId})`,
			);
			this._tracker?.releaseSession(callerSession);
			return Promise.resolve();
		}

		if (isReconnect) {
			this.cancellation?.cancel();
			this.cancellation = new CancellationTokenSource();
		}

		this._ready = true;
		this._activeClientId = params.clientId;
		this._activeClientLoadedAt = params.clientLoadedAt;

		this._sessionState = 'healthy';
		// Identity accepted — safe to supersede: release every registration NOT owned by this
		// session. Deferred to here (not to registration time) so a stale straggler's announcement
		// — which also replays its retained subscriptions, but never reaches this line — can't tear
		// down a still-live client's registrations. See `SubscriptionTracker.releaseAllExcept`.
		//
		// MUST run before the provider callbacks below: a provider that reseeds synchronously from
		// onReady/onReconnect (e.g. AllowedSignersWebview firing a results-changed event) would
		// otherwise push that reseed to a not-yet-released interloper's still-live registration.
		this._tracker?.releaseAllExcept(callerSession);

		if (isReconnect) {
			void this.provider.onReconnect?.();
		} else {
			void this.provider.onReady?.();
		}

		return Promise.resolve();
	}

	getTelemetryContext(): WebviewTelemetryContext {
		return {
			'context.webview.id': this.id,
			'context.webview.type': this.descriptor.type,
			'context.webview.instanceId': this.instanceId,
			'context.webview.host': this.is('editor')
				? 'editor'
				: (this.descriptor as WebviewViewDescriptor).location === 'panel'
					? 'panel'
					: 'view',
		};
	}

	sendTelemetryEvent<T extends keyof TelemetryEvents>(
		name: T,
		...args: [keyof WebviewTelemetryEvents[T]] extends [never]
			? [data?: never, source?: Source]
			: [data: WebviewTelemetryEvents[T], source?: Source]
	): void {
		if (!this.container.telemetry.enabled) return;

		this.container.telemetry.sendEvent(
			name,
			{
				...this.getTelemetryContext(),
				...this.provider.getTelemetryContext?.(),
				...(args[0] as any),
			},
			args[1],
		);
	}

	is(
		type: 'editor',
	): this is WebviewController<ID & (WebviewPanelIds | CustomEditorIds), State, SerializedState, ShowingArgs>;
	is(type: 'view'): this is WebviewController<ID & WebviewViewIds, State, SerializedState, ShowingArgs>;
	is(
		type: 'editor' | 'view',
	): this is WebviewController<ID & (CustomEditorIds | WebviewIds), State, SerializedState, ShowingArgs> {
		return type === 'editor' ? this._isInEditor : !this._isInEditor;
	}

	get active(): boolean | undefined {
		if ('active' in this.parent) {
			return this._disposed ? false : this.parent.active;
		}
		return this._disposed ? false : undefined;
	}

	get badge(): ViewBadge | undefined {
		return 'badge' in this.parent ? this.parent.badge : undefined;
	}
	set badge(value: ViewBadge | undefined) {
		if ('badge' in this.parent) {
			this.parent.badge = value;
		} else {
			throw new Error("The 'badge' property not supported on Webview parent");
		}
	}

	private _description: string | undefined;
	get description(): string | undefined {
		if ('description' in this.parent) {
			return this.parent.description;
		}
		return this._description;
	}
	set description(value: string | undefined) {
		if ('description' in this.parent) {
			this.parent.description = value;
		}
		this._description = value;
	}

	private _originalTitle: string;
	get originalTitle(): string {
		return this._originalTitle;
	}

	get title(): string {
		return this.parent.title ?? this._originalTitle;
	}
	set title(value: string) {
		this.parent.title = value;
	}

	get visible(): boolean {
		return this._disposed ? false : this.parent.visible;
	}

	canReuseInstance(
		options?: WebviewShowOptions,
		...args: WebviewShowingArgs<ShowingArgs, SerializedState>
	): boolean | undefined {
		if (!this.is('editor')) return undefined;

		if (options?.column != null && options.column !== this.parent.viewColumn) return false;
		return this.provider.canReuseInstance?.(...args);
	}

	getSplitArgs(): WebviewShowingArgs<ShowingArgs, SerializedState> {
		if (this.is('view')) return [];

		return this.provider.getSplitArgs?.() ?? [];
	}

	@trace({ args: false })
	async show(
		loading: boolean,
		options?: WebviewShowOptions,
		...args: WebviewShowingArgs<ShowingArgs, SerializedState>
	): Promise<void> {
		options ??= {};

		using sw = new Stopwatch(`WebviewController.show(${this.id})`);

		let context;
		const result = await this.provider.onShowing?.(loading, options, ...args);
		if (result != null) {
			let show;
			[show, context] = result;
			if (show === false) {
				this.sendTelemetryEvent(`${this.descriptor.type}/showAborted`, {
					loading: loading,
					duration: sw.elapsed(),
				});
				return;
			}
		}

		if (loading) {
			this.cancellation ??= new CancellationTokenSource();
			try {
				const html = await this.getHtml(this.webview);
				Logger.info(
					`WebviewController(${this.id}|${this.instanceId}): webview.html set (reason=show:loading, length=${html.length})`,
				);
				this._lastHtmlSetAt = Date.now();
				this.invalidateSession();
				this.webview.html = html;
			} catch (ex) {
				if (isCancellationError(ex)) {
					this.cancellation.cancel();
					return;
				}

				throw ex;
			}
		}

		if (this.is('editor')) {
			if (!loading) {
				this.parent.reveal(
					options.column ?? this.parent.viewColumn ?? this.descriptor.column ?? ViewColumn.Beside,
					options.preserveFocus ?? false,
				);
			}
		} else if (this.is('view')) {
			await executeCoreCommand(getViewFocusCommand(this.id), options);
			if (loading) {
				this.provider.onVisibilityChanged?.(true);
			}
		}

		setContextKeys(this.descriptor.contextKeyPrefix);

		this.sendTelemetryEvent(
			`${this.descriptor.type}/shown`,
			{
				loading: loading,
				duration: sw.elapsed(),
				...context,
			},
			options.source,
		);
	}

	get baseWebviewState(): WebviewState<ID> {
		return {
			webviewId: this.id,
			webviewInstanceId: this.instanceId,
			timestamp: Date.now(),
		};
	}

	private readonly _cspNonce = getNonce();
	get cspNonce(): string {
		return this._cspNonce;
	}

	asWebviewUri(uri: Uri): Uri {
		return this.webview.asWebviewUri(uri);
	}

	@trace()
	async refresh(force?: boolean): Promise<void> {
		// In-flight coalesce: piggyback on an existing refresh rather than tearing down the iframe twice.
		if (this._refreshing != null) return this._refreshing;

		// Post-refresh quiet window: drop rapid back-to-back invocations. Protects against a second
		// invocation (VS Code title-bar command double-dispatch, user double-click, or a late async
		// caller) firing shortly after the previous refresh completes and tearing down a mid-render iframe.
		if (Date.now() - this._lastRefreshCompletedAt < WebviewController.refreshCoalesceMs) {
			getScopedLogger()?.info(`refresh coalesced (within ${WebviewController.refreshCoalesceMs}ms of previous)`);
			return;
		}

		this._refreshing = this.refreshCore(force).finally(() => {
			this._lastRefreshCompletedAt = Date.now();
			this._refreshing = undefined;
		});
		return this._refreshing;
	}

	private async refreshCore(force?: boolean): Promise<void> {
		this.cancellation?.cancel();
		this.cancellation = new CancellationTokenSource();

		this.provider.onRefresh?.(force);

		// Mark the webview as not ready, until we know if we are changing the html
		const wasReady = this._ready;
		this._ready = false;

		// Mute the RPC transports for the reload window: from here until the reloaded iframe's session
		// announces itself over RPC (triggering the expose() connection swap in RpcHost), host events
		// would otherwise post through the OLD connection into a page that no longer holds their
		// callback proxies — logged client-side as "Proxy target not found for notify" on every fire.
		// Treat the window as hidden instead: save-last pendings captured here die with the tracker
		// reset in the connection swap, and the fresh handshake's subscribe-then-seed re-produces
		// everything, so nothing is lost. The `onClientSession` hook restores visibility; the
		// html-unchanged early return below restores it directly. Without RPC services there is no
		// session to announce, so no mute is latched (and nothing consumes the buffer).
		if (this._rpcHost != null) {
			this.setTransportsMuted(true);
		}

		let html;
		try {
			html = await this.getHtml(this.webview);
		} catch (ex) {
			// No reload is going to happen — lift the reload-window mute so the still-live iframe keeps
			// receiving events. On the cancellation path a superseding connect/refresh usually restores
			// it too (via the onClientSession hook), but the cancel can also come from a caller that
			// never follows up.
			this.setTransportsMuted(false);
			if (isCancellationError(ex)) {
				this.cancellation.cancel();
				return;
			}

			throw ex;
		}

		if (force) {
			// Reset the html to get the webview to reload
			Logger.info(
				`WebviewController(${this.id}|${this.instanceId}): webview.html set (reason=refresh:reset, length=0)`,
			);
			this._lastHtmlSetAt = Date.now();
			this.webview.html = '';
		}

		// If we aren't changing the html, mark the webview as ready again
		if (this.webview.html === html) {
			if (wasReady) {
				this._ready = true;
			}
			// No reload happened — lift the reload-window mute applied above.
			this.setTransportsMuted(false);
			return;
		}

		Logger.info(
			`WebviewController(${this.id}|${this.instanceId}): webview.html set (reason=refresh:apply, length=${html.length})`,
		);
		this._lastHtmlSetAt = Date.now();
		this.invalidateSession();
		this.webview.html = html;
	}

	@trace()
	private onParentDisposed() {
		this.dispose();
	}

	@trace()
	focusChanged(focused: boolean, _inputFocused: boolean): void {
		setContextKeys(this.descriptor.contextKeyPrefix);
		this.handleFocusChanged(focused);
	}

	@trace()
	private onParentVisibilityChanged(visible: boolean, active?: boolean, forceReload?: boolean) {
		if (this.descriptor.webviewHostOptions?.retainContextWhenHidden !== true) {
			if (visible) {
				if (!this._ready) {
					if (this.provider.onReloaded != null) {
						this.provider.onReloaded();
					} else {
						void this.refresh();
					}
				}
			} else {
				this._ready = false;
				this.invalidateSession();
			}
		} else if (forceReload) {
			void this.refresh();
		}

		if (visible) {
			void this.container.usage.track(`${this.descriptor.trackingFeature}:shown`).catch();

			setContextKeys(this.descriptor.contextKeyPrefix);
			if (active != null) {
				this.provider.onActiveChanged?.(active);
				if (!active) {
					this.handleFocusChanged(false);

					void this.removePlusFeatureOverride();
				}
			}
		} else {
			resetContextKeys(this.descriptor.contextKeyPrefix);

			void this.removePlusFeatureOverride();

			if (active != null) {
				this.provider.onActiveChanged?.(false);
			}
			this.handleFocusChanged(false);
		}

		this._onDidChangeVisibility.fire(visible);
		// During a reload window (html reset → session announcement → expose() swap, see `refreshCore`)
		// the transports are deliberately muted — a visibility event landing mid-window must not un-mute
		// them and resume posting into the dead session; the `onClientSession` hook restores visibility
		// when the announcing generation's swap completes.
		if (!this._reloadMuted) {
			this._eventBuffer?.setVisible(visible);
			this._rpcHost?.setVisible(visible);
		}
		this.provider.onVisibilityChanged?.(visible);
	}

	private onWindowStateChanged(e: WindowState) {
		if (!this.visible) return;

		this._onDidChangeWindowFocus.fire(e.focused);
		this.provider.onWindowFocusChanged?.(e.focused);
	}

	private handleFocusChanged(focused: boolean) {
		this._onDidChangeFocus.fire(focused);
		this.provider.onFocusChanged?.(focused);
	}

	getRootUri(): Uri {
		return this.container.context.extensionUri;
	}

	private _webRoot: string | undefined;
	getWebRoot(): string {
		this._webRoot ??= this.asWebviewUri(this.getWebRootUri()).toString();
		return this._webRoot;
	}

	private _webRootUri: Uri | undefined;
	getWebRootUri(): Uri {
		this._webRootUri ??= Uri.joinPath(this.getRootUri(), 'dist', 'webviews');
		return this._webRootUri;
	}

	@trace({ args: false })
	private async getHtml(webview: Webview): Promise<string> {
		const scope = getScopedLogger();

		const webRootUri = this.getWebRootUri();
		const uri = Uri.joinPath(webRootUri, this.descriptor.fileName);

		const [bytes, bootstrap, head, body, endOfBody] = await Promise.all([
			workspace.fs.readFile(uri),
			this.provider.includeBootstrap?.(true),
			this.provider.includeHead?.(),
			this.provider.includeBody?.(),
			this.provider.includeEndOfBody?.(),
		]);

		const sw = maybeStopWatch(scope, { log: { onlyExit: true, level: 'debug' } });
		const serialized = serializeIpcData(bootstrap);
		sw?.stop({ message: `\u2022 serialized bootstrap; length=${serialized.length}` });

		const html = replaceWebviewHtmlTokens(
			utf8Decoder.decode(bytes),
			this.id,
			this.instanceId,
			webview.cspSource,
			this._cspNonce,
			this.asWebviewUri(this.getRootUri()).toString(),
			this.getWebRoot(),
			this.is('editor')
				? 'editor'
				: (this.descriptor as WebviewViewDescriptor).location === 'panel'
					? 'panel'
					: 'view',
			serialized,
			head,
			body,
			endOfBody,
		);
		return html;
	}
}

const htmlTokensRegex =
	/#{(head|body|endOfBody|webviewId|webviewInstanceId|placement|cspSource|cspNonce|root|webroot|state)}/g;

export function replaceWebviewHtmlTokens<SerializedState>(
	html: string,
	webviewId: string,
	webviewInstanceId: string | undefined,
	cspSource: string,
	cspNonce: string,
	root: string,
	webRoot: string,
	placement: 'editor' | 'view' | 'panel',
	bootstrap?: SerializedState | string,
	head?: string,
	body?: string,
	endOfBody?: string,
): string {
	return html.replace(htmlTokensRegex, (_substring: string, token: string) => {
		switch (token) {
			case 'head':
				return head ?? '';
			case 'body':
				return body ?? '';
			case 'state':
				return bootstrap != null
					? base64(typeof bootstrap === 'string' ? bootstrap : JSON.stringify(bootstrap))
					: '';
			case 'endOfBody':
				return `${
					bootstrap != null
						? `<script type="text/javascript" nonce="${cspNonce}">window.bootstrap=${
								typeof bootstrap === 'string' ? bootstrap : JSON.stringify(bootstrap)
							};</script>`
						: ''
				}${endOfBody ?? ''}`;
			case 'webviewId':
				return webviewId;
			case 'webviewInstanceId':
				return webviewInstanceId ?? '';
			case 'placement':
				return placement;
			case 'cspSource':
				return cspSource;
			case 'cspNonce':
				return cspNonce;
			case 'root':
				return root;
			case 'webroot':
				return webRoot;
			default:
				return '';
		}
	});
}

export function resetContextKeys(
	contextKeyPrefix:
		| `gitlens:webview:${WebviewPanelTypes | CustomEditorTypes}`
		| `gitlens:webviewView:${WebviewViewTypes}`,
): void {
	void setContext(`${contextKeyPrefix}:visible`, false);
}

export function setContextKeys(
	contextKeyPrefix:
		| `gitlens:webview:${WebviewPanelTypes | CustomEditorTypes}`
		| `gitlens:webviewView:${WebviewViewTypes}`,
): void {
	void setContext(`${contextKeyPrefix}:visible`, true);
}
