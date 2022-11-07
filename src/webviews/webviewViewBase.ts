import type {
	CancellationToken,
	Webview,
	WebviewView,
	WebviewViewProvider,
	WebviewViewResolveContext,
	WindowState,
} from 'vscode';
import { Disposable, Uri, window, workspace } from 'vscode';
import { getNonce } from '@env/crypto';
import type { Commands } from '../constants';
import type { Container } from '../container';
import { Logger } from '../logger';
import { executeCommand } from '../system/command';
import { debug, getLogScope, log, logName } from '../system/decorators/log';
import { serialize } from '../system/decorators/serialize';
import type { TrackedUsageFeatures } from '../usageTracker';
import type { IpcMessage, IpcMessageParams, IpcNotificationType } from './protocol';
import { ExecuteCommandType, onIpc, WebviewReadyCommandType } from './protocol';

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

@logName<WebviewViewBase<any>>((c, name) => `${name}(${c.id})`)
export abstract class WebviewViewBase<State, SerializedState = State> implements WebviewViewProvider, Disposable {
	protected readonly disposables: Disposable[] = [];
	protected isReady: boolean = false;
	private _disposableView: Disposable | undefined;
	protected _view: WebviewView | undefined;

	constructor(
		protected readonly container: Container,
		public readonly id: `gitlens.views.${string}`,
		protected readonly fileName: string,
		title: string,
		private readonly trackingFeature: TrackedUsageFeatures,
	) {
		this._title = title;
		this.disposables.push(window.registerWebviewViewProvider(id, this));
	}

	dispose() {
		this.disposables.forEach(d => void d.dispose());
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

	@log()
	async show(options?: { preserveFocus?: boolean }) {
		const scope = getLogScope();

		try {
			void (await executeCommand(`${this.id}.focus`, options));
		} catch (ex) {
			Logger.error(ex, scope);
		}
	}

	protected onInitializing?(): Disposable[] | undefined;
	protected onReady?(): void;
	protected onMessageReceived?(e: IpcMessage): void;
	protected onVisibilityChanged?(visible: boolean): void;
	protected onWindowFocusChanged?(focused: boolean): void;

	protected registerCommands?(): Disposable[];

	protected includeBootstrap?(): SerializedState | Promise<SerializedState>;
	protected includeHead?(): string | Promise<string>;
	protected includeBody?(): string | Promise<string>;
	protected includeEndOfBody?(): string | Promise<string>;

	@debug({ args: false })
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
			...(this.onInitializing?.() ?? []),
			...(this.registerCommands?.() ?? []),
		);

		await this.refresh();
		this.onVisibilityChanged?.(true);
	}

	@debug()
	protected async refresh(): Promise<void> {
		if (this._view == null) return;

		this._view.webview.html = await this.getHtml(this._view.webview);
	}

	private onViewDisposed() {
		this._disposableView?.dispose();
		this._disposableView = undefined;
		this._view = undefined;
	}

	private async onViewVisibilityChanged() {
		const visible = this.visible;
		Logger.debug(`WebviewView(${this.id}).onViewVisibilityChanged`, `visible=${visible}`);

		if (visible) {
			void this.container.usage.track(`${this.trackingFeature}:shown`);
			await this.refresh();
		}
		this.onVisibilityChanged?.(visible);
	}

	private onWindowStateChanged(e: WindowState) {
		if (!this.visible) return;

		this.onWindowFocusChanged?.(e.focused);
	}

	@debug<WebviewViewBase<State>['onMessageReceivedCore']>({
		args: { 0: e => (e != null ? `${e.id}: method=${e.method}` : '<undefined>') },
	})
	private onMessageReceivedCore(e: IpcMessage) {
		if (e == null) return;

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

	protected getWebRoot() {
		if (this._view == null) return;

		const webRootUri = Uri.joinPath(this.container.context.extensionUri, 'dist', 'webviews');
		const webRoot = this._view.webview.asWebviewUri(webRootUri).toString();

		return webRoot;
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
								? `<script type="text/javascript" nonce="${cspNonce}">window.bootstrap=${JSON.stringify(
										bootstrap,
								  )};</script>`
								: ''
						}${endOfBody ?? ''}`;
					case 'placement':
						return 'view';
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

		return html;
	}

	protected notify<T extends IpcNotificationType<any>>(
		type: T,
		params: IpcMessageParams<T>,
		completionId?: string,
	): Thenable<boolean> {
		return this.postMessage({ id: nextIpcId(), method: type.method, params: params, completionId: completionId });
	}

	@serialize()
	@debug<WebviewViewBase<State>['postMessage']>({
		args: { 0: m => `(id=${m.id}, method=${m.method}${m.completionId ? `, completionId=${m.completionId}` : ''})` },
	})
	protected postMessage(message: IpcMessage) {
		if (this._view == null) return Promise.resolve(false);

		// It looks like there is a bug where `postMessage` can sometimes just hang infinitely. Not sure why, but ensure we don't hang
		return Promise.race<boolean>([
			this._view.webview.postMessage(message),
			new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000)),
		]);
	}
}
