import {
	commands,
	Disposable,
	Uri,
	ViewColumn,
	Webview,
	WebviewPanel,
	WebviewPanelOnDidChangeViewStateEvent,
	window,
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

export abstract class WebviewBase<State> implements Disposable {
	protected readonly disposables: Disposable[] = [];
	protected isReady: boolean = false;
	private _disposablePanel: Disposable | undefined;
	private _panel: WebviewPanel | undefined;

	constructor(
		protected readonly container: Container,
		public readonly id: string,
		private readonly fileName: string,
		private readonly iconPath: string,
		title: string,
		showCommand: Commands,
	) {
		this._title = title;
		this.disposables.push(commands.registerCommand(showCommand, this.onShowCommand, this));
	}

	dispose() {
		this.disposables.forEach(d => d.dispose());
		this._disposablePanel?.dispose();
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

	hide() {
		this._panel?.dispose();
	}

	async show(column: ViewColumn = ViewColumn.Beside): Promise<void> {
		if (this._panel == null) {
			this._panel = window.createWebviewPanel(
				this.id,
				this._title,
				{ viewColumn: column, preserveFocus: false },
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
				...this.registerCommands(),
			);

			this._panel.webview.html = await this.getHtml(this._panel.webview);
		} else {
			const html = await this.getHtml(this._panel.webview);

			// Reset the html to get the webview to reload
			this._panel.webview.html = '';
			this._panel.webview.html = html;

			this._panel.reveal(this._panel.viewColumn ?? ViewColumn.Active, false);
		}
	}

	protected onReady?(): void;
	protected onMessageReceived?(e: IpcMessage): void;

	protected registerCommands(): Disposable[] {
		return emptyCommands;
	}

	protected includeBootstrap?(): State | Promise<State>;
	protected includeHead?(): string | Promise<string>;
	protected includeBody?(): string | Promise<string>;
	protected includeEndOfBody?(): string | Promise<string>;

	private onPanelDisposed() {
		this._disposablePanel?.dispose();
		this._disposablePanel = undefined;
		this._panel = undefined;
	}

	protected onShowCommand(): void {
		void this.show();
	}

	protected onViewStateChanged(e: WebviewPanelOnDidChangeViewStateEvent): void {
		Logger.log(
			`Webview(${this.id}).onViewStateChanged`,
			`active=${e.webviewPanel.active}, visible=${e.webviewPanel.visible}`,
		);
	}

	protected onMessageReceivedCore(e: IpcMessage) {
		if (e == null) return;

		Logger.log(`Webview(${this.id}).onMessageReceived: method=${e.method}, data=${JSON.stringify(e)}`);

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
		const uri = Uri.joinPath(this.container.context.extensionUri, 'dist', 'webviews', this.fileName);
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
			.replace(/#{(cspSource|cspNonce|root)}/g, (substring, token) => {
				switch (token) {
					case 'cspSource':
						return cspSource;
					case 'cspNonce':
						return cspNonce;
					case 'root':
						return root;
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
		if (this._panel == null) return Promise.resolve(false);

		return this._panel.webview.postMessage(message);
	}
}
