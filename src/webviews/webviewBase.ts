import type { Webview, WebviewPanel, WebviewPanelOnDidChangeViewStateEvent } from 'vscode';
import { Disposable, Uri, ViewColumn, window, workspace } from 'vscode';
import { getNonce } from '@env/crypto';
import type { Commands } from '../constants';
import type { Container } from '../container';
import { Logger } from '../logger';
import { executeCommand, registerCommand } from '../system/command';
import { debug, log, logName } from '../system/decorators/log';
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

@logName<WebviewBase<any>>((c, name) => `${name}(${c.id})`)
export abstract class WebviewBase<State> implements Disposable {
	protected readonly disposables: Disposable[] = [];
	protected isReady: boolean = false;
	private _disposablePanel: Disposable | undefined;
	protected _panel: WebviewPanel | undefined;

	constructor(
		protected readonly container: Container,
		public readonly id: `gitlens.${string}`,
		private readonly fileName: string,
		private readonly iconPath: string,
		title: string,
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
				{
					retainContextWhenHidden: true,
					enableFindWidget: true,
					enableCommandUris: true,
					enableScripts: true,
				},
			);

			this._panel.iconPath = Uri.file(this.container.context.asAbsolutePath(this.iconPath));
			this._disposablePanel = Disposable.from(
				this._panel,
				this._panel.onDidDispose(this.onPanelDisposed, this),
				this._panel.onDidChangeViewState(this.onViewStateChanged, this),
				this._panel.webview.onDidReceiveMessage(this.onMessageReceivedCore, this),
				...(this.onInitializing?.() ?? []),
				...(this.registerCommands?.() ?? []),
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
	protected onFocusChanged?(focused: boolean): void;
	protected onVisibilityChanged?(visible: boolean): void;

	protected registerCommands?(): Disposable[];

	protected includeBootstrap?(): State | Promise<State>;
	protected includeHead?(): string | Promise<string>;
	protected includeBody?(): string | Promise<string>;
	protected includeEndOfBody?(): string | Promise<string>;

	@debug()
	protected async refresh(force?: boolean): Promise<void> {
		if (this._panel == null) return;

		const html = await this.getHtml(this._panel.webview);
		if (force) {
			// Reset the html to get the webview to reload
			this._panel.webview.html = '';
		}
		this._panel.webview.html = html;
	}

	private onPanelDisposed() {
		this.onVisibilityChanged?.(false);
		this.onFocusChanged?.(false);

		this._disposablePanel?.dispose();
		this._disposablePanel = undefined;
		this._panel = undefined;
	}

	protected onShowCommand(...args: unknown[]): void {
		void this.show(undefined, ...args);
	}

	protected onViewStateChanged(e: WebviewPanelOnDidChangeViewStateEvent): void {
		Logger.debug(
			`Webview(${this.id}).onViewStateChanged`,
			`active=${e.webviewPanel.active}, visible=${e.webviewPanel.visible}`,
		);
		this.onVisibilityChanged?.(e.webviewPanel.visible);
		this.onFocusChanged?.(e.webviewPanel.active);
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
			(_substring, token) => {
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

	protected notify<T extends IpcNotificationType<any>>(type: T, params: IpcMessageParams<T>): Thenable<boolean> {
		return this.postMessage({ id: nextIpcId(), method: type.method, params: params });
	}

	@serialize()
	@debug<WebviewBase<State>['postMessage']>({ args: { 0: m => `(id=${m.id}, method=${m.method})` } })
	private postMessage(message: IpcMessage): Promise<boolean> {
		if (this._panel == null) return Promise.resolve(false);

		// It looks like there is a bug where `postMessage` can sometimes just hang infinitely. Not sure why, but ensure we don't hang
		return Promise.race<boolean>([
			this._panel.webview.postMessage(message),
			new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000)),
		]);
	}
}
