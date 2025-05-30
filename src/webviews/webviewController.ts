import type { ViewBadge, Webview, WebviewPanel, WebviewView, WindowState } from 'vscode';
import { Disposable, EventEmitter, Uri, ViewColumn, window, workspace } from 'vscode';
import { getNonce } from '@env/crypto';
import type { Commands, CustomEditorTypes, WebviewTypes, WebviewViewTypes } from '../constants';
import type { Container } from '../container';
import { pauseOnCancelOrTimeout } from '../system/cancellation';
import { executeCommand, executeCoreCommand } from '../system/command';
import { setContext } from '../system/context';
import { debug, logName } from '../system/decorators/log';
import { serialize } from '../system/decorators/serialize';
import { Logger } from '../system/logger';
import { getLogScope, setLogScopeExit } from '../system/logger.scope';
import { isPromise } from '../system/promise';
import type { WebviewContext } from '../system/webview';
import type {
	IpcMessage,
	IpcMessageParams,
	IpcNotificationType,
	WebviewFocusChangedParams,
	WebviewState,
} from './protocol';
import { ExecuteCommandType, onIpc, WebviewFocusChangedCommandType, WebviewReadyCommandType } from './protocol';
import type { WebviewCommandCallback, WebviewCommandRegistrar } from './webviewCommandRegistrar';
import type { WebviewPanelDescriptor, WebviewShowOptions, WebviewViewDescriptor } from './webviewsController';

const maxSmallIntegerV8 = 2 ** 30; // Max number that can be stored in V8's smis (small integers)
const utf8TextDecoder = new TextDecoder('utf8');

let ipcSequence = 0;
function nextIpcId() {
	if (ipcSequence === maxSmallIntegerV8) {
		ipcSequence = 1;
	} else {
		ipcSequence++;
	}

	return `host:${ipcSequence}`;
}

type GetParentType<T extends WebviewPanelDescriptor | WebviewViewDescriptor> = T extends WebviewPanelDescriptor
	? WebviewPanel
	: T extends WebviewViewDescriptor
	? WebviewView
	: never;

export type WebviewShowingArgs<T extends unknown[], SerializedState> = T | [{ state: Partial<SerializedState> }] | [];

export interface WebviewProvider<State, SerializedState = State, ShowingArgs extends unknown[] = unknown[]>
	extends Disposable {
	/**
	 * Determines whether the webview instance can be reused
	 * @returns `true` if the webview should be reused, `false` if it should NOT be reused, and `undefined` if it *could* be reused but not ideal
	 */
	canReuseInstance?(...args: WebviewShowingArgs<ShowingArgs, SerializedState>): boolean | undefined;
	getSplitArgs?(): WebviewShowingArgs<ShowingArgs, SerializedState>;
	onShowing?(
		loading: boolean,
		options: WebviewShowOptions,
		...args: WebviewShowingArgs<ShowingArgs, SerializedState>
	): boolean | Promise<boolean>;
	registerCommands?(): Disposable[];

	includeBootstrap?(): SerializedState | Promise<SerializedState>;
	includeHead?(): string | Promise<string>;
	includeBody?(): string | Promise<string>;
	includeEndOfBody?(): string | Promise<string>;

	onReady?(): void;
	onRefresh?(force?: boolean): void;
	onReloaded?(): void;
	onMessageReceived?(e: IpcMessage): void;
	onActiveChanged?(active: boolean): void;
	onFocusChanged?(focused: boolean): void;
	onVisibilityChanged?(visible: boolean): void;
	onWindowFocusChanged?(focused: boolean): void;
}

type WebviewPanelController<
	State,
	SerializedState = State,
	ShowingArgs extends unknown[] = unknown[],
> = WebviewController<State, SerializedState, ShowingArgs, WebviewPanelDescriptor>;
type WebviewViewController<
	State,
	SerializedState = State,
	ShowingArgs extends unknown[] = unknown[],
> = WebviewController<State, SerializedState, ShowingArgs, WebviewViewDescriptor>;

@logName<WebviewController<any>>(c => `WebviewController(${c.id}${c.instanceId != null ? `|${c.instanceId}` : ''})`)
export class WebviewController<
	State,
	SerializedState = State,
	ShowingArgs extends unknown[] = unknown[],
	Descriptor extends WebviewPanelDescriptor | WebviewViewDescriptor = WebviewPanelDescriptor | WebviewViewDescriptor,
> implements Disposable
{
	static async create<State, SerializedState = State, ShowingArgs extends unknown[] = unknown[]>(
		container: Container,
		commandRegistrar: WebviewCommandRegistrar,
		descriptor: WebviewPanelDescriptor,
		instanceId: string | undefined,
		parent: WebviewPanel,
		resolveProvider: (
			container: Container,
			controller: WebviewController<State, SerializedState, ShowingArgs>,
		) => Promise<WebviewProvider<State, SerializedState, ShowingArgs>>,
	): Promise<WebviewController<State, SerializedState, ShowingArgs, WebviewPanelDescriptor>>;
	static async create<State, SerializedState = State, ShowingArgs extends unknown[] = unknown[]>(
		container: Container,
		commandRegistrar: WebviewCommandRegistrar,
		descriptor: WebviewViewDescriptor,
		instanceId: string | undefined,
		parent: WebviewView,
		resolveProvider: (
			container: Container,
			controller: WebviewController<State, SerializedState, ShowingArgs>,
		) => Promise<WebviewProvider<State, SerializedState, ShowingArgs>>,
	): Promise<WebviewController<State, SerializedState, ShowingArgs, WebviewViewDescriptor>>;
	static async create<State, SerializedState = State, ShowingArgs extends unknown[] = unknown[]>(
		container: Container,
		commandRegistrar: WebviewCommandRegistrar,
		descriptor: WebviewPanelDescriptor | WebviewViewDescriptor,
		instanceId: string | undefined,
		parent: WebviewPanel | WebviewView,
		resolveProvider: (
			container: Container,
			controller: WebviewController<State, SerializedState, ShowingArgs>,
		) => Promise<WebviewProvider<State, SerializedState, ShowingArgs>>,
	): Promise<WebviewController<State, SerializedState, ShowingArgs>> {
		const controller = new WebviewController<State, SerializedState, ShowingArgs>(
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
	get onDidDispose() {
		return this._onDidDispose.event;
	}

	public readonly id: Descriptor['id'];

	private _ready: boolean = false;
	get ready() {
		return this._ready;
	}

	private disposable: Disposable | undefined;
	private /*readonly*/ provider!: WebviewProvider<State, SerializedState, ShowingArgs>;
	private readonly webview: Webview;

	private constructor(
		private readonly container: Container,
		private readonly _commandRegistrar: WebviewCommandRegistrar,
		private readonly descriptor: Descriptor,
		public readonly instanceId: string | undefined,
		public readonly parent: GetParentType<Descriptor>,
		resolveProvider: (
			container: Container,
			controller: WebviewController<State, SerializedState, ShowingArgs>,
		) => Promise<WebviewProvider<State, SerializedState, ShowingArgs>>,
	) {
		this.id = descriptor.id;
		this.webview = parent.webview;

		const isInEditor = 'onDidChangeViewState' in parent;
		this._isEditor = isInEditor;
		this._originalTitle = descriptor.title;
		parent.title = descriptor.title;

		this._initializing = resolveProvider(container, this).then(provider => {
			this.provider = provider;
			if (this._disposed) {
				provider.dispose();
				return;
			}

			this.disposable = Disposable.from(
				window.onDidChangeWindowState(this.onWindowStateChanged, this),
				parent.webview.onDidReceiveMessage(this.onMessageReceivedCore, this),
				isInEditor
					? parent.onDidChangeViewState(({ webviewPanel: { visible, active } }) =>
							this.onParentVisibilityChanged(visible, active),
					  )
					: parent.onDidChangeVisibility(() => this.onParentVisibilityChanged(this.visible, this.active)),
				parent.onDidDispose(this.onParentDisposed, this),
				...(this.provider.registerCommands?.() ?? []),
				this.provider,
			);
		});
	}

	private _disposed: boolean = false;
	dispose() {
		this._disposed = true;
		resetContextKeys(this.descriptor.contextKeyPrefix);

		this.provider?.onFocusChanged?.(false);
		this.provider?.onVisibilityChanged?.(false);

		this._ready = false;

		this._onDidDispose.fire();
		this.disposable?.dispose();
	}

	registerWebviewCommand<T extends Partial<WebviewContext>>(command: string, callback: WebviewCommandCallback<T>) {
		return this._commandRegistrar.registerCommand(this.provider, this.id, this.instanceId, command, callback);
	}

	private _initializing: Promise<void> | undefined;
	private async initialize() {
		if (this._initializing == null) return;

		await this._initializing;
		this._initializing = undefined;
	}

	private _isEditor: boolean;
	isEditor(): this is WebviewPanelController<State, SerializedState> {
		return this._isEditor;
	}
	isView(): this is WebviewViewController<State, SerializedState> {
		return !this._isEditor;
	}

	get active() {
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

	get visible() {
		return this._disposed ? false : this.parent.visible;
	}

	canReuseInstance(
		options?: WebviewShowOptions,
		...args: WebviewShowingArgs<ShowingArgs, SerializedState>
	): boolean | undefined {
		if (!this.isEditor()) return undefined;

		if (options?.column != null && options.column !== this.parent.viewColumn) return false;
		return this.provider.canReuseInstance?.(...args);
	}

	getSplitArgs(): WebviewShowingArgs<ShowingArgs, SerializedState> {
		if (!this.isEditor()) return [];

		return this.provider.getSplitArgs?.() ?? [];
	}

	@debug({ args: false })
	async show(
		loading: boolean,
		options?: WebviewShowOptions,
		...args: WebviewShowingArgs<ShowingArgs, SerializedState>
	) {
		if (options == null) {
			options = {};
		}

		const result = this.provider.onShowing?.(loading, options, ...args);
		if (result != null) {
			if (isPromise(result)) {
				if ((await result) === false) return;
			} else if (result === false) {
				return;
			}
		}

		if (loading) {
			this.webview.html = await this.getHtml(this.webview);
		}

		if (this.isEditor()) {
			if (!loading) {
				this.parent.reveal(
					options.column ?? this.parent.viewColumn ?? this.descriptor.column ?? ViewColumn.Beside,
					options.preserveFocus ?? false,
				);
			}
		} else if (this.isView()) {
			await executeCoreCommand(`${this.id}.focus`, options);
			if (loading) {
				this.provider.onVisibilityChanged?.(true);
			}
		}

		setContextKeys(this.descriptor.contextKeyPrefix);
	}

	get baseWebviewState(): WebviewState {
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

	@debug()
	async refresh(force?: boolean): Promise<void> {
		if (force) {
			this.clearPendingIpcNotifications();
		}
		this.provider.onRefresh?.(force);

		// Mark the webview as not ready, until we know if we are changing the html
		const wasReady = this._ready;
		this._ready = false;

		const html = await this.getHtml(this.webview);
		if (force) {
			// Reset the html to get the webview to reload
			this.webview.html = '';
		}

		// If we aren't changing the html, mark the webview as ready again
		if (this.webview.html === html) {
			if (wasReady) {
				this._ready = true;
			}
			return;
		}

		this.webview.html = html;
	}

	@debug()
	private onParentDisposed() {
		this.dispose();
	}

	@debug<WebviewController<State>['onMessageReceivedCore']>({
		args: { 0: e => (e != null ? `${e.id}: method=${e.method}` : '<undefined>') },
	})
	private onMessageReceivedCore(e: IpcMessage) {
		if (e == null) return;

		switch (e.method) {
			case WebviewReadyCommandType.method:
				onIpc(WebviewReadyCommandType, e, () => {
					this._ready = true;
					this.sendPendingIpcNotifications();
					this.provider.onReady?.();
				});

				break;

			case WebviewFocusChangedCommandType.method:
				onIpc(WebviewFocusChangedCommandType, e, params => {
					this.onViewFocusChanged(params);
				});

				break;

			case ExecuteCommandType.method:
				onIpc(ExecuteCommandType, e, params => {
					if (params.args != null) {
						void executeCommand(params.command as Commands, ...params.args);
					} else {
						void executeCommand(params.command as Commands);
					}
				});
				break;

			default:
				this.provider.onMessageReceived?.(e);
				break;
		}
	}

	@debug<WebviewController<State>['onViewFocusChanged']>({
		args: { 0: e => `focused=${e.focused}, inputFocused=${e.inputFocused}` },
	})
	onViewFocusChanged(e: WebviewFocusChangedParams): void {
		setContextKeys(this.descriptor.contextKeyPrefix);
		this.provider.onFocusChanged?.(e.focused);
	}

	@debug()
	private onParentVisibilityChanged(visible: boolean, active?: boolean) {
		if (this.descriptor.webviewHostOptions?.retainContextWhenHidden !== true) {
			if (visible) {
				if (this._ready) {
					this.sendPendingIpcNotifications();
				} else if (this.provider.onReloaded != null) {
					this.clearPendingIpcNotifications();
					this.provider.onReloaded();
				} else {
					void this.refresh();
				}
			} else {
				this._ready = false;
			}
		}

		if (visible) {
			void this.container.usage.track(`${this.descriptor.trackingFeature}:shown`);

			setContextKeys(this.descriptor.contextKeyPrefix);
			if (active != null) {
				this.provider.onActiveChanged?.(active);
				if (!active) {
					this.provider.onFocusChanged?.(false);
				}
			}
		} else {
			resetContextKeys(this.descriptor.contextKeyPrefix);

			if (active != null) {
				this.provider.onActiveChanged?.(false);
			}
			this.provider.onFocusChanged?.(false);
		}

		this.provider.onVisibilityChanged?.(visible);
	}

	private onWindowStateChanged(e: WindowState) {
		if (!this.visible) return;

		this.provider.onWindowFocusChanged?.(e.focused);
	}

	getRootUri() {
		return this.container.context.extensionUri;
	}

	private _webRoot: string | undefined;
	getWebRoot() {
		if (this._webRoot == null) {
			this._webRoot = this.asWebviewUri(this.getWebRootUri()).toString();
		}
		return this._webRoot;
	}

	private _webRootUri: Uri | undefined;
	getWebRootUri() {
		if (this._webRootUri == null) {
			this._webRootUri = Uri.joinPath(this.getRootUri(), 'dist', 'webviews');
		}
		return this._webRootUri;
	}

	private async getHtml(webview: Webview): Promise<string> {
		const webRootUri = this.getWebRootUri();
		const uri = Uri.joinPath(webRootUri, this.descriptor.fileName);

		const [bytes, bootstrap, head, body, endOfBody] = await Promise.all([
			workspace.fs.readFile(uri),
			this.provider.includeBootstrap?.(),
			this.provider.includeHead?.(),
			this.provider.includeBody?.(),
			this.provider.includeEndOfBody?.(),
		]);

		const html = replaceWebviewHtmlTokens(
			utf8TextDecoder.decode(bytes),
			this.id,
			this.instanceId,
			webview.cspSource,
			this._cspNonce,
			this.asWebviewUri(this.getRootUri()).toString(),
			this.getWebRoot(),
			this.isEditor() ? 'editor' : 'view',
			bootstrap,
			head,
			body,
			endOfBody,
		);
		return html;
	}

	nextIpcId(): string {
		return nextIpcId();
	}

	async notify<T extends IpcNotificationType<any>>(
		type: T,
		params: IpcMessageParams<T>,
		completionId?: string,
	): Promise<boolean> {
		const msg: IpcMessage = {
			id: this.nextIpcId(),
			method: type.method,
			params: params,
			completionId: completionId,
		};

		const success = await this.postMessage(msg);
		if (success) {
			this._pendingIpcNotifications.clear();
		} else {
			this.addPendingIpcNotificationCore(type, msg);
		}
		return success;
	}

	@serialize()
	@debug<WebviewController<State>['postMessage']>({
		args: false,
		enter: m => `(${m.id}|${m.method}${m.completionId ? `+${m.completionId}` : ''})`,
	})
	private async postMessage(message: IpcMessage): Promise<boolean> {
		if (!this._ready) return Promise.resolve(false);

		const scope = getLogScope();
		let timeout: ReturnType<typeof setTimeout> | undefined;

		// It looks like there is a bug where `postMessage` can sometimes just hang infinitely. Not sure why, but ensure we don't hang forever
		const promise = Promise.race<boolean>([
			this.webview.postMessage(message).then(
				s => {
					clearTimeout(timeout);
					return s;
				},
				ex => {
					clearTimeout(timeout);
					Logger.error(scope, ex);
					debugger;
					return false;
				},
			),
			new Promise<boolean>(resolve => {
				timeout = setTimeout(() => {
					debugger;
					setLogScopeExit(scope, undefined, 'TIMEDOUT');
					resolve(false);
				}, 5000);
			}),
		]);

		let success;

		if (this.isView()) {
			// If we are in a view, show progress if we are waiting too long
			const result = await pauseOnCancelOrTimeout(promise, undefined, 100);
			if (result.paused) {
				success = await window.withProgress({ location: { viewId: this.id } }, () => result.value);
			} else {
				success = result.value;
			}
		} else {
			success = await promise;
		}

		return success;
	}

	private _pendingIpcNotifications = new Map<IpcNotificationType, IpcMessage | (() => Promise<boolean>)>();

	addPendingIpcNotification(
		type: IpcNotificationType<any>,
		mapping: Map<IpcNotificationType<any>, () => Promise<boolean>>,
		thisArg: any,
	) {
		this.addPendingIpcNotificationCore(type, mapping.get(type)?.bind(thisArg));
	}

	private addPendingIpcNotificationCore(
		type: IpcNotificationType<any>,
		msgOrFn: IpcMessage | (() => Promise<boolean>) | undefined,
	) {
		if (type.reset) {
			this._pendingIpcNotifications.clear();
		}

		if (msgOrFn == null) {
			debugger;
			return;
		}
		this._pendingIpcNotifications.set(type, msgOrFn);
	}

	clearPendingIpcNotifications() {
		this._pendingIpcNotifications.clear();
	}

	sendPendingIpcNotifications() {
		if (!this._ready || this._pendingIpcNotifications.size === 0) return;

		const ipcs = new Map(this._pendingIpcNotifications);
		this._pendingIpcNotifications.clear();
		for (const msgOrFn of ipcs.values()) {
			if (typeof msgOrFn === 'function') {
				void msgOrFn();
			} else {
				void this.postMessage(msgOrFn);
			}
		}
	}
}

export function replaceWebviewHtmlTokens<SerializedState>(
	html: string,
	webviewId: string,
	webviewInstanceId: string | undefined,
	cspSource: string,
	cspNonce: string,
	root: string,
	webRoot: string,
	placement: 'editor' | 'view',
	bootstrap?: SerializedState,
	head?: string,
	body?: string,
	endOfBody?: string,
) {
	return html.replace(
		/#{(head|body|endOfBody|webviewId|webviewInstanceId|placement|cspSource|cspNonce|root|webroot)}/g,
		(_substring: string, token: string) => {
			switch (token) {
				case 'head':
					return head ?? '';
				case 'body':
					return body ?? '';
				case 'endOfBody':
					return `${
						bootstrap != null
							? `<script type="text/javascript" nonce="${cspNonce}">window.bootstrap=${JSON.stringify(
									bootstrap,
							  )};</script>`
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
		},
	);
}

export function resetContextKeys(
	contextKeyPrefix: `gitlens:webview:${WebviewTypes | CustomEditorTypes}` | `gitlens:webviewView:${WebviewViewTypes}`,
): void {
	void setContext(`${contextKeyPrefix}:visible`, false);
}

export function setContextKeys(
	contextKeyPrefix: `gitlens:webview:${WebviewTypes | CustomEditorTypes}` | `gitlens:webviewView:${WebviewViewTypes}`,
): void {
	void setContext(`${contextKeyPrefix}:visible`, true);
}

export function updatePendingContext<Context extends object>(
	current: Context,
	pending: Partial<Context> | undefined,
	update: Partial<Context>,
	force: boolean = false,
): [changed: boolean, pending: Partial<Context> | undefined] {
	let changed = false;
	for (const [key, value] of Object.entries(update)) {
		const currentValue = (current as unknown as Record<string, unknown>)[key];
		if (
			!force &&
			(currentValue instanceof Uri || value instanceof Uri) &&
			(currentValue as any)?.toString() === value?.toString()
		) {
			continue;
		}

		if (!force && currentValue === value) {
			if ((value !== undefined || key in current) && (pending == null || !(key in pending))) {
				continue;
			}
		}

		if (pending == null) {
			pending = {};
		}

		(pending as Record<string, unknown>)[key] = value;
		changed = true;
	}

	return [changed, pending];
}
