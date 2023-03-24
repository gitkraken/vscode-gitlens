import type {
	CancellationToken,
	WebviewOptions,
	WebviewPanelOptions,
	WebviewView,
	WebviewViewResolveContext,
} from 'vscode';
import { Disposable, Uri, ViewColumn, window } from 'vscode';
import type { Commands, ContextKeys } from '../constants';
import type { Container } from '../container';
import { ensurePlusFeaturesEnabled } from '../plus/subscription/utils';
import { executeCommand, registerCommand } from '../system/command';
import type { TrackedUsageFeatures } from '../telemetry/usageTracker';
import type { WebviewProvider } from './webviewController';
import { WebviewController } from './webviewController';

export type CustomEditorIds = 'rebaseEditor';
export type WebviewIds = 'graph' | 'settings' | 'timeline' | 'welcome' | 'focus';
export type WebviewViewIds = 'commitDetails' | 'graph' | 'home' | 'timeline';

export interface WebviewPanelDescriptor<State = any, SerializedState = State> {
	readonly fileName: string;
	readonly iconPath: string;
	readonly title: string;
	readonly contextKeyPrefix: `${ContextKeys.WebviewPrefix}${WebviewIds}`;
	readonly trackingFeature: TrackedUsageFeatures;
	readonly plusFeature: boolean;
	readonly options?: WebviewOptions;
	readonly panelOptions?: WebviewPanelOptions;
	resolveWebviewProvider(
		container: Container,
		id: `gitlens.${WebviewIds}` | `gitlens.views.${WebviewViewIds}`,
		host: WebviewController<State, SerializedState>,
	): Promise<WebviewProvider<State, SerializedState>>;
}

export interface WebviewViewDescriptor<State = any, SerializedState = State> {
	readonly fileName: string;
	readonly title: string;
	readonly contextKeyPrefix: `${ContextKeys.WebviewViewPrefix}${WebviewViewIds}`;
	readonly trackingFeature: TrackedUsageFeatures;
	readonly plusFeature: boolean;
	readonly options?: WebviewOptions;
	resolveWebviewProvider(
		container: Container,
		id: `gitlens.${WebviewIds}` | `gitlens.views.${WebviewViewIds}`,
		host: WebviewController<State, SerializedState>,
	): Promise<WebviewProvider<State, SerializedState>>;
}

interface WebviewPanelMetadata<State = any, SerializedState = State> {
	readonly id: `gitlens.${WebviewIds}`;
	readonly descriptor: WebviewPanelDescriptor<State, SerializedState>;
	webview?: WebviewController<State, SerializedState> | undefined;
}

interface WebviewViewMetadata<State = any, SerializedState = State> {
	readonly id: `gitlens.views.${WebviewViewIds}`;
	readonly descriptor: WebviewViewDescriptor<State, SerializedState>;
	webview?: WebviewController<State, SerializedState> | undefined;
	pendingShowArgs?: Parameters<WebviewViewProxy['show']> | undefined;
}

export interface WebviewViewProxy extends Disposable {
	readonly id: string;
	readonly loaded: boolean;
	readonly visible: boolean;
	refresh(force?: boolean): Promise<void>;
	show(options?: { preserveFocus?: boolean }, ...args: unknown[]): Promise<void>;
}

export interface WebviewPanelProxy extends Disposable {
	readonly id: string;
	readonly visible: boolean;
	refresh(force?: boolean): Promise<void>;
	show(options?: { column?: ViewColumn; preserveFocus?: boolean }, ...args: unknown[]): Promise<void>;
}

export class WebviewsController implements Disposable {
	private readonly disposables: Disposable[] = [];
	private readonly _panels = new Map<string, WebviewPanelMetadata>();
	private readonly _views = new Map<string, WebviewViewMetadata>();

	constructor(private readonly container: Container) {}

	dispose() {
		this.disposables.forEach(d => void d.dispose());
	}

	registerWebviewView<State, SerializedState = State>(
		id: `gitlens.views.${WebviewViewIds}`,
		descriptor: Omit<WebviewViewDescriptor<State, SerializedState>, 'id'>,
	): WebviewViewProxy {
		const metadata: WebviewViewMetadata<State, SerializedState> = { id: id, descriptor: descriptor };
		this._views.set(id, metadata);

		const disposables: Disposable[] = [];
		disposables.push(
			window.registerWebviewViewProvider(id, {
				resolveWebviewView: async (
					webviewView: WebviewView,
					_context: WebviewViewResolveContext<SerializedState>,
					token: CancellationToken,
				) => {
					if (metadata.descriptor.plusFeature) {
						if (!(await ensurePlusFeaturesEnabled())) return;
						if (token.isCancellationRequested) return;
					}

					webviewView.webview.options = {
						...descriptor.options,
						enableCommandUris: true,
						enableScripts: true,
						localResourceRoots: [Uri.file(this.container.context.extensionPath)],
					};

					webviewView.title = descriptor.title;

					const webview = await WebviewController.create(
						this.container,
						id,
						webviewView.webview,
						webviewView,
						descriptor,
					);

					metadata.webview = webview;
					disposables.push(
						webview.onDidDispose(() => {
							metadata.pendingShowArgs = undefined;
							metadata.webview = undefined;
						}, this),
						webview,
					);

					if (metadata.pendingShowArgs != null) {
						await webview.show(true, ...metadata.pendingShowArgs);
						metadata.pendingShowArgs = undefined;
					} else {
						await webview.show(true);
					}
				},
			}),
		);

		const disposable = Disposable.from(...disposables);
		this.disposables.push(disposable);
		return {
			id: id,
			get loaded() {
				return metadata.webview != null;
			},
			get visible() {
				return metadata.webview?.visible ?? false;
			},
			dispose: function () {
				disposable.dispose();
			},
			refresh: async force => metadata.webview?.refresh(force),
			// eslint-disable-next-line @typescript-eslint/require-await
			show: async (options?: { preserveFocus?: boolean }, ...args) => {
				if (metadata.webview != null) return void metadata.webview.show(false, options, ...args);

				metadata.pendingShowArgs = [options, ...args];
				return void executeCommand(`${id}.focus`, options);
			},
		} satisfies WebviewViewProxy;
	}

	registerWebviewPanel<State, SerializedState = State>(
		command: Commands,
		id: `gitlens.${WebviewIds}`,
		descriptor: Omit<WebviewPanelDescriptor<State, SerializedState>, 'id'>,
	): WebviewPanelProxy {
		const metadata: WebviewPanelMetadata<State, SerializedState> = { id: id, descriptor: descriptor };
		this._panels.set(id, metadata);

		const disposables: Disposable[] = [];
		const { container } = this;

		async function show(
			options?: { column?: ViewColumn; preserveFocus?: boolean },
			...args: unknown[]
		): Promise<void> {
			const { webview, descriptor } = metadata;

			if (descriptor.plusFeature) {
				if (!(await ensurePlusFeaturesEnabled())) return;
			}

			void container.usage.track(`${descriptor.trackingFeature}:shown`);

			let column = options?.column ?? ViewColumn.Beside;
			// Only try to open beside if there is an active tab
			if (column === ViewColumn.Beside && window.tabGroups.activeTabGroup.activeTab == null) {
				column = ViewColumn.Active;
			}

			if (webview == null) {
				const panel = window.createWebviewPanel(
					metadata.id,
					descriptor.title,
					{ viewColumn: column, preserveFocus: options?.preserveFocus ?? false },
					{
						...descriptor.panelOptions,
						...(descriptor.options ?? {
							retainContextWhenHidden: true,
							enableFindWidget: true,
							enableCommandUris: true,
							enableScripts: true,
							localResourceRoots: [Uri.file(container.context.extensionPath)],
						}),
					},
				);

				panel.iconPath = Uri.file(container.context.asAbsolutePath(descriptor.iconPath));

				const webview = await WebviewController.create(container, id, panel.webview, panel, descriptor);
				metadata.webview = webview;

				disposables.push(
					webview.onDidDispose(() => (metadata.webview = undefined)),
					webview,
				);

				await webview.show(true, options, ...args);
			} else {
				await webview.show(false, options, ...args);
			}
		}

		const disposable = Disposable.from(
			...disposables,
			registerCommand(command, (...args) => show(undefined, ...args), this),
		);
		this.disposables.push(disposable);
		return {
			id: id,
			get visible() {
				return metadata.webview?.visible ?? false;
			},
			dispose: function () {
				disposable.dispose();
			},
			refresh: async force => metadata.webview?.refresh(force),
			show: show,
		} satisfies WebviewPanelProxy;
	}
}
