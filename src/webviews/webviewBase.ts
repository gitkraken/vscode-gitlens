import type {
	Webview,
	WebviewOptions,
	WebviewPanel,
	WebviewPanelOnDidChangeViewStateEvent,
	WebviewPanelOptions,
	WindowState,
} from 'vscode';
import { Disposable, Uri, ViewColumn, window, workspace } from 'vscode';
import { getNonce } from '@env/crypto';
import type { Commands, ContextKeys } from '../constants';
import type { Container } from '../container';
import { setContext } from '../context';
import { executeCommand, registerCommand } from '../system/command';
import { debug, log, logName } from '../system/decorators/log';
import { serialize } from '../system/decorators/serialize';
import type { TrackedUsageFeatures } from '../telemetry/usageTracker';
import type { IpcMessage, IpcMessageParams, IpcNotificationType, WebviewFocusChangedParams } from './protocol';
import { ExecuteCommandType, onIpc, WebviewFocusChangedCommandType, WebviewReadyCommandType } from './protocol';

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

export type WebviewIds = 'graph' | 'settings' | 'timeline' | 'welcome' | 'focus';

@logName<WebviewBase<any>>((c, name) => `${name}(${c.id})`)
export abstract class WebviewBase<State> implements Disposable {
	protected readonly disposables: Disposable[] = [];
	protected isReady: boolean = false;
	private _disposablePanel: Disposable | undefined;
	protected _panel: WebviewPanel | undefined;

	constructor(
		protected readonly container: Container,
		public readonly id: `gitlens.${WebviewIds}`,
		private readonly fileName: string,
		private readonly iconPath: string,
		title: string,
		private readonly contextKeyPrefix: `${ContextKeys.WebviewPrefix}${WebviewIds}`,
		private readonly trackingFeature: TrackedUsageFeatures,
		showCommand: Commands,
	) {
		this._originalTitle = this._title = title;
		this.disposables.push(registerCommand(showCommand, this.onShowCommand, this));
	}

	dispose() {
		this.disposables.forEach(d => void d.dispose());
		this._disposablePanel?.dispose();
	}

	protected get options(): WebviewPanelOptions & WebviewOptions {
		return {
			retainContextWhenHidden: true,
			enableFindWidget: true,
			enableCommandUris: true,
			enableScripts: true,
		};
	}
	private _originalTitle: string | undefined;
	get originalTitle(): string | undefined {
		return this._originalTitle;
	}

	private _title: string;
	get title(): string {
		return this._panel?.title ?? this._title;
	}
	set title(title: string) {
		this._title = title;
		if (this._panel == null) return;

		this._panel.title = title;
	}

	get visible() {
		return this._panel?.visible ?? false;
	}

	@log()
	hide() {
		this._panel?.dispose();
	}

	@log({ args: false })
	async show(options?: { column?: ViewColumn; preserveFocus?: boolean }, ..._args: unknown[]): Promise<void> {
		void this.container.usage.track(`${this.trackingFeature}:shown`);

		let column = options?.column ?? ViewColumn.Beside;
		// Only try to open beside if there is an active tab
		if (column === ViewColumn.Beside && window.tabGroups.activeTabGroup.activeTab == null) {
			column = ViewColumn.Active;
		}

		if (this._panel == null) {
			this._panel = window.createWebviewPanel(
				this.id,
				this._title,
				{ viewColumn: column, preserveFocus: options?.preserveFocus ?? false },
				this.options,
			);

			this._panel.iconPath = Uri.file(this.container.context.asAbsolutePath(this.iconPath));
			this._disposablePanel = Disposable.from(
				this._panel,
				this._panel.onDidDispose(this.onPanelDisposed, this),
				this._panel.onDidChangeViewState(this.onViewStateChanged, this),
				this._panel.webview.onDidReceiveMessage(this.onMessageReceivedCore, this),
				...(this.onInitializing?.() ?? []),
				...(this.registerCommands?.() ?? []),
				window.onDidChangeWindowState(this.onWindowStateChanged, this),
			);

			this._panel.webview.html = await this.getHtml(this._panel.webview);
		} else {
			await this.refresh(true);
			this._panel.reveal(this._panel.viewColumn ?? ViewColumn.Active, options?.preserveFocus ?? false);
		}
	}

	private readonly _cspNonce = getNonce();
	protected get cspNonce(): string {
		return this._cspNonce;
	}

	protected onInitializing?(): Disposable[] | undefined;
	protected onReady?(): void;
	protected onMessageReceived?(e: IpcMessage): void;
	protected onActiveChanged?(active: boolean): void;
	protected onFocusChanged?(focused: boolean): void;
	protected onVisibilityChanged?(visible: boolean): void;
	protected onWindowFocusChanged?(focused: boolean): void;

	protected registerCommands?(): Disposable[];

	protected includeBootstrap?(): State | Promise<State>;
	protected includeHead?(): string | Promise<string>;
	protected includeBody?(): string | Promise<string>;
	protected includeEndOfBody?(): string | Promise<string>;

	private onWindowStateChanged(e: WindowState) {
		if (!this.visible) return;

		this.onWindowFocusChanged?.(e.focused);
	}

	@debug()
	protected async refresh(force?: boolean): Promise<void> {
		if (this._panel == null) return;

		// Mark the webview as not ready, until we know if we are changing the html
		this.isReady = false;
		const html = await this.getHtml(this._panel.webview);
		if (force) {
			// Reset the html to get the webview to reload
			this._panel.webview.html = '';
		}

		// If we aren't changing the html, mark the webview as ready again
		if (this._panel.webview.html === html) {
			this.isReady = true;
			return;
		}

		this._panel.webview.html = html;
	}

	private resetContextKeys(): void {
		void setContext(`${this.contextKeyPrefix}:inputFocus`, false);
		void setContext(`${this.contextKeyPrefix}:focus`, false);
		void setContext(`${this.contextKeyPrefix}:active`, false);
	}

	private setContextKeys(active: boolean | undefined, focus?: boolean, inputFocus?: boolean): void {
		if (active != null) {
			void setContext(`${this.contextKeyPrefix}:active`, active);

			if (!active) {
				focus = false;
				inputFocus = false;
			}
		}
		if (focus != null) {
			void setContext(`${this.contextKeyPrefix}:focus`, focus);
		}
		if (inputFocus != null) {
			void setContext(`${this.contextKeyPrefix}:inputFocus`, inputFocus);
		}
	}

	private onPanelDisposed() {
		this.resetContextKeys();

		this.onActiveChanged?.(false);
		this.onFocusChanged?.(false);
		this.onVisibilityChanged?.(false);

		this.isReady = false;
		this._disposablePanel?.dispose();
		this._disposablePanel = undefined;
		this._panel = undefined;
	}

	protected onShowCommand(...args: unknown[]): void {
		void this.show(undefined, ...args);
	}

	@debug<WebviewBase<State>['onViewFocusChanged']>({
		args: { 0: e => `focused=${e.focused}, inputFocused=${e.inputFocused}` },
	})
	protected onViewFocusChanged(e: WebviewFocusChangedParams): void {
		this.setContextKeys(undefined, e.focused, e.inputFocused);
		this.onFocusChanged?.(e.focused);
	}

	@debug<WebviewBase<State>['onViewStateChanged']>({
		args: { 0: e => `active=${e.webviewPanel.active}, visible=${e.webviewPanel.visible}` },
	})
	protected onViewStateChanged(e: WebviewPanelOnDidChangeViewStateEvent): void {
		const { active, visible } = e.webviewPanel;
		if (visible) {
			this.setContextKeys(active);
			this.onActiveChanged?.(active);
			if (!active) {
				this.onFocusChanged?.(false);
			}
		} else {
			this.resetContextKeys();

			this.onActiveChanged?.(false);
			this.onFocusChanged?.(false);
		}

		this.onVisibilityChanged?.(visible);
	}

	@debug<WebviewBase<State>['onMessageReceivedCore']>({
		args: { 0: e => (e != null ? `${e.id}: method=${e.method}` : '<undefined>') },
	})
	protected onMessageReceivedCore(e: IpcMessage) {
		if (e == null) return;

		switch (e.method) {
			case WebviewReadyCommandType.method:
				onIpc(WebviewReadyCommandType, e, () => {
					this.isReady = true;
					this.onReady?.();
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
				this.onMessageReceived?.(e);
				break;
		}
	}

	private async getHtml(webview: Webview): Promise<string> {
		const webRootUri = Uri.joinPath(this.container.context.extensionUri, 'dist', 'webviews');
		const uri = Uri.joinPath(webRootUri, this.fileName);
		const content = new TextDecoder('utf8').decode(await workspace.fs.readFile(uri));

		const [bootstrap, head, body, endOfBody] = await Promise.all([
			this.includeBootstrap?.(),
			this.includeHead?.(),
			this.includeBody?.(),
			this.includeEndOfBody?.(),
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
						return 'editor';
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

	protected nextIpcId(): string {
		return nextIpcId();
	}

	protected notify<T extends IpcNotificationType<any>>(
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
	@debug<WebviewBase<State>['postMessage']>({
		args: {
			0: m => `{"id":${m.id},"method":${m.method}${m.completionId ? `,"completionId":${m.completionId}` : ''}}`,
		},
	})
	protected postMessage(message: IpcMessage): Promise<boolean> {
		if (this._panel == null || !this.isReady || !this.visible) return Promise.resolve(false);

		// It looks like there is a bug where `postMessage` can sometimes just hang infinitely. Not sure why, but ensure we don't hang
		return Promise.race<boolean>([
			this._panel.webview.postMessage(message),
			new Promise<boolean>(resolve => setTimeout(resolve, 5000, false)),
		]);
	}
}
