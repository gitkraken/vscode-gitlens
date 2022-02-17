import {
	CancellationToken,
	Disposable,
	Uri,
	Webview,
	WebviewView,
	WebviewViewProvider,
	WebviewViewResolveContext,
	window,
	WindowState,
	workspace,
} from 'vscode';
import { getNonce } from '@env/crypto';
import { Commands } from '../constants';
import type { Container } from '../container';
import { Logger } from '../logger';
import { executeCommand } from '../system/command';
import {
	ExecuteCommandType,
	IpcMessage,
	IpcMessageParams,
	IpcNotificationType,
	onIpc,
	WebviewReadyCommandType,
} from './protocol';

let ipcSequence = 0;
function nextIpcId() {
	if (ipcSequence === Number.MAX_SAFE_INTEGER) {
		ipcSequence = 1;
	} else {
		ipcSequence++;
	}

	return `host:${ipcSequence}`;
}

const emptyCommands: Disposable[] = [
	{
		dispose: function () {
			/* noop */
		},
	},
];

export abstract class WebviewViewBase<State> implements WebviewViewProvider, Disposable {
	protected readonly disposables: Disposable[] = [];
	protected isReady: boolean = false;
	private _disposableView: Disposable | undefined;
	private _view: WebviewView | undefined;

	constructor(
		protected readonly container: Container,
		public readonly id: string,
		protected readonly fileName: string,
		title: string,
	) {
		this._title = title;
		this.disposables.push(window.registerWebviewViewProvider(id, this));
	}

	dispose() {
		this.disposables.forEach(d => d.dispose());
		this._disposableView?.dispose();
	}

	get description(): string | undefined {
		return this._view?.description;
	}
	set description(description: string | undefined) {
		if (this._view == null) return;

		this._view.description = description;
	}

	private _title: string;
	get title(): string {
		return this._view?.title ?? this._title;
	}
	set title(title: string) {
		this._title = title;
		if (this._view == null) return;

		this._view.title = title;
	}

	get visible() {
		return this._view?.visible ?? false;
	}

	protected onReady?(): void;
	protected onMessageReceived?(e: IpcMessage): void;
	protected onVisibilityChanged?(visible: boolean): void;
	protected onWindowFocusChanged?(focused: boolean): void;

	protected registerCommands(): Disposable[] {
		return emptyCommands;
	}

	protected includeBootstrap?(): State | Promise<State>;
	protected includeHead?(): string | Promise<string>;
	protected includeBody?(): string | Promise<string>;
	protected includeEndOfBody?(): string | Promise<string>;

	async resolveWebviewView(
		webviewView: WebviewView,
		_context: WebviewViewResolveContext,
		_token: CancellationToken,
	): Promise<void> {
		this._view = webviewView;

		webviewView.webview.options = {
			enableCommandUris: true,
			enableScripts: true,
		};

		webviewView.title = this._title;

		this._disposableView = Disposable.from(
			this._view.onDidDispose(this.onViewDisposed, this),
			this._view.onDidChangeVisibility(this.onViewVisibilityChanged, this),
			this._view.webview.onDidReceiveMessage(this.onMessageReceivedCore, this),
			window.onDidChangeWindowState(this.onWindowStateChanged, this),
			...this.registerCommands(),
		);

		webviewView.webview.html = await this.getHtml(webviewView.webview);

		this.onViewVisibilityChanged();
	}

	private onViewDisposed() {
		this._disposableView?.dispose();
		this._disposableView = undefined;
		this._view = undefined;
	}

	private onViewVisibilityChanged() {
		const visible = this.visible;
		Logger.debug(`WebviewView(${this.id}).onViewVisibilityChanged`, `visible=${visible}`);
		this.onVisibilityChanged?.(visible);
	}

	private onWindowStateChanged(e: WindowState) {
		this.onWindowFocusChanged?.(e.focused);
	}

	private onMessageReceivedCore(e: IpcMessage) {
		if (e == null) return;

		Logger.debug(`WebviewView(${this.id}).onMessageReceived: method=${e.method}, data=${JSON.stringify(e)}`);

		switch (e.method) {
			case WebviewReadyCommandType.method:
				onIpc(WebviewReadyCommandType, e, () => {
					this.isReady = true;
					this.onReady?.();
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
		const cspNonce = getNonce();

		const root = webview.asWebviewUri(this.container.context.extensionUri).toString();
		const webRoot = webview.asWebviewUri(webRootUri).toString();

		const html = content
			.replace(/#{(head|body|endOfBody)}/i, (_substring, token) => {
				switch (token) {
					case 'head':
						return head ?? '';
					case 'body':
						return body ?? '';
					case 'endOfBody':
						return bootstrap != null
							? `<script type="text/javascript" nonce="#{cspNonce}">window.bootstrap = ${JSON.stringify(
									bootstrap,
							  )};</script>${endOfBody ?? ''}`
							: endOfBody ?? '';
					default:
						return '';
				}
			})
			.replace(/#{(cspSource|cspNonce|root|webroot)}/g, (_substring, token) => {
				switch (token) {
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

		return html;
	}

	protected notify<T extends IpcNotificationType<any>>(type: T, params: IpcMessageParams<T>): Thenable<boolean> {
		return this.postMessage({ id: nextIpcId(), method: type.method, params: params });
	}

	private postMessage(message: IpcMessage) {
		if (this._view == null) return Promise.resolve(false);

		return this._view.webview.postMessage(message);
	}
}
