import type {
	Disposable,
	Webview,
	WebviewPanel,
	WebviewPanelOnDidChangeViewStateEvent,
	WebviewView,
	WindowState,
} from 'vscode';
import { EventEmitter, Uri, ViewColumn, window, workspace } from 'vscode';
import { getNonce } from '@env/crypto';
import type { Commands } from '../constants';
import { ContextKeys } from '../constants';
import type { Container } from '../container';
import { setContext } from '../context';
import { executeCommand } from '../system/command';
import { debug, logName } from '../system/decorators/log';
import { serialize } from '../system/decorators/serialize';
import type { TrackedUsageFeatures } from '../telemetry/usageTracker';
import type { IpcMessage, IpcMessageParams, IpcNotificationType, WebviewFocusChangedParams } from './protocol';
import { ExecuteCommandType, onIpc, WebviewFocusChangedCommandType, WebviewReadyCommandType } from './protocol';
import type { WebviewIds, WebviewPanelDescriptor, WebviewViewDescriptor, WebviewViewIds } from './webviewsController';

const maxSmallIntegerV8 = 2 ** 30; // Max number that can be stored in V8's smis (small integers)

let ipcSequence = 0;
function nextIpcId() {
	if (ipcSequence === maxSmallIntegerV8) {
		ipcSequence = 1;
	} else {
		ipcSequence++;
	}

	return `host:${ipcSequence}`;
}

export interface WebviewProvider<State> extends Disposable {
	canShowWebviewPanel?(
		firstTime: boolean,
		options?: { column?: ViewColumn; preserveFocus?: boolean },
		...args: unknown[]
	): boolean | Promise<boolean>;
	onShowWebviewPanel?(
		firstTime: boolean,
		options?: { column?: ViewColumn; preserveFocus?: boolean },
		...args: unknown[]
	): void | Promise<void>;
	registerCommands?(): Disposable[];

	includeBootstrap?(): State | Promise<State>;
	includeHead?(): string | Promise<string>;
	includeBody?(): string | Promise<string>;
	includeEndOfBody?(): string | Promise<string>;

	onReady?(): void;
	onRefresh?(force?: boolean): void;
	onMessageReceived?(e: IpcMessage): void;
	onActiveChanged?(active: boolean): void;
	onFocusChanged?(focused: boolean): void;
	onVisibilityChanged?(visible: boolean): void;
	onWindowFocusChanged?(focused: boolean): void;
}

@logName<WebviewController<any>>((c, name) => `${name}(${c.id})`)
export class WebviewController<State, SerializedState = State> implements Disposable {
	static async create<State>(
		container: Container,
		id: `gitlens.${WebviewIds}`,
		webview: Webview,
		parent: WebviewPanel,
		metadata: WebviewPanelDescriptor<State>,
	): Promise<WebviewController<State>>;
	static async create<State>(
		container: Container,
		id: `gitlens.views.${WebviewViewIds}`,
		webview: Webview,
		parent: WebviewView,
		metadata: WebviewViewDescriptor<State>,
	): Promise<WebviewController<State>>;
	static async create<State>(
		container: Container,
		id: `gitlens.${WebviewIds}` | `gitlens.views.${WebviewViewIds}`,
		webview: Webview,
		parent: WebviewPanel | WebviewView,
		metadata: WebviewPanelDescriptor<State> | WebviewViewDescriptor<State>,
	): Promise<WebviewController<State>> {
		const controller = new WebviewController<State>(
			container,
			id,
			webview,
			parent,
			metadata.title,
			metadata.fileName,
			metadata.contextKeyPrefix,
			metadata.trackingFeature,
			host => metadata.resolveWebviewProvider(container, id, host),
		);
		await controller.initialize();
		return controller;
	}

	private readonly _onDidDispose = new EventEmitter<WebviewController<State, SerializedState>>();
	get onDidDispose() {
		return this._onDidDispose.event;
	}

	private _isReady: boolean = false;
	get isReady() {
		return this._isReady;
	}

	readonly type: 'tab' | 'view';
	isType(type: 'tab'): this is WebviewController<State, SerializedState> & {
		type: 'tab';
		id: `gitlens.${WebviewIds}`;
		parent: WebviewPanel;
	};
	isType(type: 'view'): this is WebviewController<State, SerializedState> & {
		type: 'view';
		id: `gitlens.views.${WebviewViewIds}`;
		parent: WebviewView;
	};
	isType(type: 'tab' | 'view') {
		return this.type === type;
	}

	private readonly disposables: Disposable[] = [];
	private /*readonly*/ provider!: WebviewProvider<State>;

	private constructor(
		private readonly container: Container,
		public readonly id: `gitlens.${WebviewIds}` | `gitlens.views.${WebviewViewIds}`,
		public readonly webview: Webview,
		public readonly parent: WebviewPanel | WebviewView,
		title: string,
		private readonly fileName: string,
		private readonly contextKeyPrefix:
			| `${ContextKeys.WebviewPrefix}${WebviewIds}`
			| `${ContextKeys.WebviewViewPrefix}${WebviewViewIds}`,
		private readonly trackingFeature: TrackedUsageFeatures,
		resolveProvider: (host: WebviewController<State>) => Promise<WebviewProvider<State>>,
	) {
		const isInTab = 'onDidChangeViewState' in parent;
		this.type = isInTab ? 'tab' : 'view';
		this._originalTitle = title;
		parent.title = title;

		this._initializing = resolveProvider(this).then(provider => {
			this.provider = provider;
			this.disposables.push(
				window.onDidChangeWindowState(this.onWindowStateChanged, this),
				webview.onDidReceiveMessage(this.onMessageReceivedCore, this),
				isInTab
					? parent.onDidChangeViewState(this.onParentViewStateChanged, this)
					: parent.onDidChangeVisibility(() => this.onParentVisibilityChanged(this.visible), this),
				parent.onDidDispose(this.onParentDisposed, this),
				...(this.provider.registerCommands?.() ?? []),
				this.provider,
			);
		});
	}

	private _initializing: Promise<void> | undefined;
	private async initialize() {
		if (this._initializing == null) return;

		await this._initializing;
		this._initializing = undefined;
	}

	dispose() {
		resetContextKeys(this.contextKeyPrefix);

		this.provider.onFocusChanged?.(false);
		this.provider.onVisibilityChanged?.(false);

		this._isReady = false;

		this._onDidDispose.fire(this);
		this.disposables.forEach(d => void d.dispose());
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
		return this.parent.visible;
	}

	async show(firstTime: boolean, options?: { column?: ViewColumn; preserveFocus?: boolean }, ...args: unknown[]) {
		if (this.isType('tab')) {
			const result = await this.provider.canShowWebviewPanel?.(firstTime, options, ...args);
			if (result === false) return;

			if (firstTime) {
				this.webview.html = await this.getHtml(this.webview);
			}

			await this.provider.onShowWebviewPanel?.(firstTime, options, ...args);
			if (firstTime) {
				this.parent.reveal(this.parent.viewColumn ?? ViewColumn.Active, options?.preserveFocus ?? false);
			}
		} else if (this.isType('view')) {
			if (firstTime) {
				this.webview.html = await this.getHtml(this.webview);
			}

			if (firstTime) {
				void executeCommand(`${this.id}.focus`, options);
			}
			this.provider.onVisibilityChanged?.(true);
		}
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
		this.provider.onRefresh?.(force);

		// Mark the webview as not ready, until we know if we are changing the html
		this._isReady = false;
		const html = await this.getHtml(this.webview);
		if (force) {
			// Reset the html to get the webview to reload
			this.webview.html = '';
		}

		// If we aren't changing the html, mark the webview as ready again
		if (this.webview.html === html) {
			this._isReady = true;
			return;
		}

		this.webview.html = html;
	}

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
					this._isReady = true;
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
		setContextKeys(this.contextKeyPrefix, undefined, e.focused, e.inputFocused);
		this.provider.onFocusChanged?.(e.focused);
	}

	@debug<WebviewController<State>['onParentViewStateChanged']>({
		args: { 0: e => `active=${e.webviewPanel.active}, visible=${e.webviewPanel.visible}` },
	})
	private onParentViewStateChanged(e: WebviewPanelOnDidChangeViewStateEvent): void {
		const { active, visible } = e.webviewPanel;
		if (visible) {
			setContextKeys(this.contextKeyPrefix, active);
			this.provider.onActiveChanged?.(active);
			if (!active) {
				this.provider.onFocusChanged?.(false);
			}
		} else {
			resetContextKeys(this.contextKeyPrefix);

			this.provider.onActiveChanged?.(false);
			this.provider.onFocusChanged?.(false);
		}

		this.provider.onVisibilityChanged?.(visible);
	}

	@debug()
	private async onParentVisibilityChanged(visible: boolean) {
		if (visible) {
			void this.container.usage.track(`${this.trackingFeature}:shown`);
			await this.refresh();
		} else {
			resetContextKeys(this.contextKeyPrefix);
			this.provider.onFocusChanged?.(false);
		}
		this.provider.onVisibilityChanged?.(visible);
	}

	private onWindowStateChanged(e: WindowState) {
		if (!this.visible) return;

		this.provider.onWindowFocusChanged?.(e.focused);
	}

	getWebRoot() {
		return this.asWebviewUri(this.getWebRootUri()).toString();
	}

	private getWebRootUri() {
		return Uri.joinPath(this.container.context.extensionUri, 'dist', 'webviews');
	}

	private async getHtml(webview: Webview): Promise<string> {
		const webRootUri = this.getWebRootUri();
		const uri = Uri.joinPath(webRootUri, this.fileName);
		const content = new TextDecoder('utf8').decode(await workspace.fs.readFile(uri));

		const [bootstrap, head, body, endOfBody] = await Promise.all([
			this.provider.includeBootstrap?.(),
			this.provider.includeHead?.(),
			this.provider.includeBody?.(),
			this.provider.includeEndOfBody?.(),
		]);

		const cspSource = webview.cspSource;

		const root = webview.asWebviewUri(this.container.context.extensionUri).toString();
		const webRoot = webview.asWebviewUri(webRootUri).toString();

		const html = content.replace(
			/#{(head|body|endOfBody|placement|cspSource|cspNonce|root|webroot)}/g,
			(_substring: string, token: string) => {
				switch (token) {
					case 'head':
						return head ?? '';
					case 'body':
						return body ?? '';
					case 'endOfBody':
						return `${
							bootstrap != null
								? `<script type="text/javascript" nonce="${
										this.cspNonce
								  }">window.bootstrap=${JSON.stringify(bootstrap)};</script>`
								: ''
						}${endOfBody ?? ''}`;
					case 'placement':
						return 'view';
					case 'cspSource':
						return cspSource;
					case 'cspNonce':
						return this.cspNonce;
					case 'root':
						return root;
					case 'webroot':
						return webRoot;
					default:
						return '';
				}
			},
		);

		return html;
	}

	nextIpcId(): string {
		return nextIpcId();
	}

	notify<T extends IpcNotificationType<any>>(
		type: T,
		params: IpcMessageParams<T>,
		completionId?: string,
	): Promise<boolean> {
		return this.postMessage({
			id: this.nextIpcId(),
			method: type.method,
			params: params,
			completionId: completionId,
		});
	}

	@serialize()
	@debug<WebviewController<State>['postMessage']>({
		args: {
			0: m => `{"id":${m.id},"method":${m.method}${m.completionId ? `,"completionId":${m.completionId}` : ''}}`,
		},
	})
	postMessage(message: IpcMessage): Promise<boolean> {
		if (!this._isReady) return Promise.resolve(false);

		// It looks like there is a bug where `postMessage` can sometimes just hang infinitely. Not sure why, but ensure we don't hang
		return Promise.race<boolean>([
			this.webview.postMessage(message),
			new Promise<boolean>(resolve => setTimeout(resolve, 5000, false)),
		]);
	}
}

function resetContextKeys(
	contextKeyPrefix: `${ContextKeys.WebviewPrefix}${WebviewIds}` | `${ContextKeys.WebviewViewPrefix}${WebviewViewIds}`,
): void {
	void setContext(`${contextKeyPrefix}:inputFocus`, false);
	void setContext(`${contextKeyPrefix}:focus`, false);
	if (contextKeyPrefix.startsWith(ContextKeys.WebviewPrefix)) {
		void setContext(`${contextKeyPrefix as `${ContextKeys.WebviewPrefix}${WebviewIds}`}:active`, false);
	}
}

function setContextKeys(
	contextKeyPrefix: `${ContextKeys.WebviewPrefix}${WebviewIds}` | `${ContextKeys.WebviewViewPrefix}${WebviewViewIds}`,
	focus?: boolean,
	inputFocus?: boolean,
	active?: boolean,
): void {
	if (contextKeyPrefix.startsWith(ContextKeys.WebviewPrefix)) {
		if (active != null) {
			void setContext(`${contextKeyPrefix as `${ContextKeys.WebviewPrefix}${WebviewIds}`}:active`, active);

			if (!active) {
				focus = false;
				inputFocus = false;
			}
		}
	}

	if (focus != null) {
		void setContext(`${contextKeyPrefix}:focus`, focus);
	}
	if (inputFocus != null) {
		void setContext(`${contextKeyPrefix}:inputFocus`, inputFocus);
	}
}
