import type {
	CancellationToken,
	WebviewOptions,
	WebviewPanel,
	WebviewPanelOptions,
	WebviewView,
	WebviewViewResolveContext,
} from 'vscode';
import { Disposable, Uri, ViewColumn, window } from 'vscode';
import type { Commands, WebviewIds, WebviewTypes, WebviewViewIds, WebviewViewTypes } from '../constants';
import type { Container } from '../container';
import { ensurePlusFeaturesEnabled } from '../plus/subscription/utils';
import { executeCoreCommand, registerCommand } from '../system/command';
import { debug } from '../system/decorators/log';
import { Logger } from '../system/logger';
import { getLogScope } from '../system/logger.scope';
import type { TrackedUsageFeatures } from '../telemetry/usageTracker';
import { WebviewCommandRegistrar } from './webviewCommandRegistrar';
import type { WebviewProvider } from './webviewController';
import { WebviewController } from './webviewController';

export interface WebviewPanelDescriptor {
	id: WebviewIds;
	readonly fileName: string;
	readonly iconPath: string;
	readonly title: string;
	readonly contextKeyPrefix: `gitlens:webview:${WebviewTypes}`;
	readonly trackingFeature: TrackedUsageFeatures;
	readonly plusFeature: boolean;
	readonly column?: ViewColumn;
	readonly webviewOptions?: WebviewOptions;
	readonly webviewHostOptions?: WebviewPanelOptions;
}

interface WebviewPanelRegistration<State, SerializedState = State> {
	readonly descriptor: WebviewPanelDescriptor;
	controller?: WebviewController<State, SerializedState, WebviewPanelDescriptor> | undefined;
}

export interface WebviewPanelProxy extends Disposable {
	readonly id: WebviewIds;
	readonly ready: boolean;
	readonly visible: boolean;
	close(): void;
	refresh(force?: boolean): Promise<void>;
	show(options?: { column?: ViewColumn; preserveFocus?: boolean }, ...args: unknown[]): Promise<void>;
}

export interface WebviewViewDescriptor {
	id: WebviewViewIds;
	readonly fileName: string;
	readonly title: string;
	readonly contextKeyPrefix: `gitlens:webviewView:${WebviewViewTypes}`;
	readonly trackingFeature: TrackedUsageFeatures;
	readonly plusFeature: boolean;
	readonly webviewOptions?: WebviewOptions;
	readonly webviewHostOptions?: {
		readonly retainContextWhenHidden?: boolean;
	};
}

interface WebviewViewRegistration<State, SerializedState = State> {
	readonly descriptor: WebviewViewDescriptor;
	controller?: WebviewController<State, SerializedState, WebviewViewDescriptor> | undefined;
	pendingShowArgs?: Parameters<WebviewViewProxy['show']> | undefined;
}

export interface WebviewViewProxy extends Disposable {
	readonly id: WebviewViewIds;
	readonly ready: boolean;
	readonly visible: boolean;
	refresh(force?: boolean): Promise<void>;
	show(options?: { preserveFocus?: boolean }, ...args: unknown[]): Promise<void>;
}

export class WebviewsController implements Disposable {
	private readonly disposables: Disposable[] = [];
	private readonly _commandRegistrar: WebviewCommandRegistrar;
	private readonly _panels = new Map<string, WebviewPanelRegistration<any>>();
	private readonly _views = new Map<string, WebviewViewRegistration<any>>();

	constructor(private readonly container: Container) {
		this.disposables.push((this._commandRegistrar = new WebviewCommandRegistrar()));
	}

	dispose() {
		this.disposables.forEach(d => void d.dispose());
	}

	@debug<WebviewsController['registerWebviewView']>({
		args: {
			0: d => d.id,
			1: false,
			2: false,
		},
	})
	registerWebviewView<State, SerializedState = State>(
		descriptor: WebviewViewDescriptor,
		resolveProvider: (
			container: Container,
			controller: WebviewController<State, SerializedState>,
		) => Promise<WebviewProvider<State, SerializedState>>,
		canResolveProvider?: () => boolean | Promise<boolean>,
	): WebviewViewProxy {
		const scope = getLogScope();

		const registration: WebviewViewRegistration<State, SerializedState> = { descriptor: descriptor };
		this._views.set(descriptor.id, registration);

		const disposables: Disposable[] = [];
		disposables.push(
			window.registerWebviewViewProvider(
				descriptor.id,
				{
					resolveWebviewView: async (
						webviewView: WebviewView,
						context: WebviewViewResolveContext<SerializedState>,
						token: CancellationToken,
					) => {
						if (canResolveProvider != null) {
							if ((await canResolveProvider()) === false) return;
						}

						if (registration.descriptor.plusFeature) {
							if (!(await ensurePlusFeaturesEnabled())) return;
							if (token.isCancellationRequested) return;
						}

						Logger.debug(scope, `Resolving webview view (${descriptor.id})`);

						webviewView.webview.options = {
							enableCommandUris: true,
							enableScripts: true,
							localResourceRoots: [Uri.file(this.container.context.extensionPath)],
							...descriptor.webviewOptions,
						};

						webviewView.title = descriptor.title;

						const controller = await WebviewController.create(
							this.container,
							this._commandRegistrar,
							descriptor,
							webviewView,
							resolveProvider,
						);

						registration.controller?.dispose();
						registration.controller = controller;

						disposables.push(
							controller.onDidDispose(() => {
								Logger.debug(scope, `Disposing webview view (${descriptor.id})`);

								registration.pendingShowArgs = undefined;
								registration.controller = undefined;
							}),
							controller,
						);

						let args = registration.pendingShowArgs;
						registration.pendingShowArgs = undefined;
						if (args == null && isSerializedState<State>(context)) {
							args = [undefined, context];
						}

						if (args != null) {
							await controller.show(true, ...args);
						} else {
							await controller.show(true);
						}
					},
				},
				descriptor.webviewHostOptions != null ? { webviewOptions: descriptor.webviewHostOptions } : undefined,
			),
		);

		const disposable = Disposable.from(...disposables);
		this.disposables.push(disposable);
		return {
			id: descriptor.id,
			get ready() {
				return registration.controller?.ready ?? false;
			},
			get visible() {
				return registration.controller?.visible ?? false;
			},
			dispose: function () {
				disposable.dispose();
			},
			refresh: async force => registration.controller?.refresh(force),
			// eslint-disable-next-line @typescript-eslint/require-await
			show: async (options?: { preserveFocus?: boolean }, ...args) => {
				if (registration.controller != null) return void registration.controller.show(false, options, ...args);

				Logger.debug(scope, `Showing webview view (${descriptor.id})`);

				registration.pendingShowArgs = [options, ...args];
				return void executeCoreCommand(`${descriptor.id}.focus`, options);
			},
		} satisfies WebviewViewProxy;
	}

	@debug<WebviewsController['registerWebviewPanel']>({
		args: {
			0: c => c,
			1: d => d.id,
			2: false,
			3: false,
		},
	})
	registerWebviewPanel<State, SerializedState = State>(
		command: Commands,
		descriptor: WebviewPanelDescriptor,
		resolveProvider: (
			container: Container,
			controller: WebviewController<State, SerializedState>,
		) => Promise<WebviewProvider<State, SerializedState>>,
		canResolveProvider?: () => boolean | Promise<boolean>,
	): WebviewPanelProxy {
		const scope = getLogScope();

		const registration: WebviewPanelRegistration<State, SerializedState> = { descriptor: descriptor };
		this._panels.set(descriptor.id, registration);

		const disposables: Disposable[] = [];
		const { container, _commandRegistrar: commandRegistrar } = this;

		let serializedPanel: WebviewPanel | undefined;

		async function show(
			options?: { column?: ViewColumn; preserveFocus?: boolean },
			...args: unknown[]
		): Promise<void> {
			if (canResolveProvider != null) {
				if ((await canResolveProvider()) === false) return;
			}

			const { descriptor } = registration;
			if (descriptor.plusFeature) {
				if (!(await ensurePlusFeaturesEnabled())) return;
			}

			void container.usage.track(`${descriptor.trackingFeature}:shown`);

			let column = options?.column ?? descriptor.column ?? ViewColumn.Beside;
			// Only try to open beside if there is an active tab
			if (column === ViewColumn.Beside && window.tabGroups.activeTabGroup.activeTab == null) {
				column = ViewColumn.Active;
			}

			let { controller } = registration;
			if (controller == null) {
				let panel;
				if (serializedPanel != null) {
					Logger.debug(scope, `Restoring webview panel (${descriptor.id})`);

					panel = serializedPanel;
					serializedPanel = undefined;
				} else {
					Logger.debug(scope, `Creating webview panel (${descriptor.id})`);

					panel = window.createWebviewPanel(
						descriptor.id,
						descriptor.title,
						{ viewColumn: column, preserveFocus: options?.preserveFocus ?? false },
						{
							...{
								enableCommandUris: true,
								enableScripts: true,
								localResourceRoots: [Uri.file(container.context.extensionPath)],
							},
							...descriptor.webviewOptions,
							...descriptor.webviewHostOptions,
						},
					);
				}

				panel.iconPath = Uri.file(container.context.asAbsolutePath(descriptor.iconPath));

				controller = await WebviewController.create(
					container,
					commandRegistrar,
					descriptor,
					panel,
					resolveProvider,
				);
				registration.controller = controller;

				disposables.push(
					controller.onDidDispose(() => {
						Logger.debug(scope, `Disposing webview panel (${descriptor.id})`);

						registration.controller = undefined;
					}),
					controller,
				);

				await controller.show(true, options, ...args);
			} else {
				Logger.debug(scope, `Showing webview panel (${descriptor.id})`);
				await controller.show(false, options, ...args);
			}
		}

		async function deserializeWebviewPanel(panel: WebviewPanel, state: SerializedState) {
			// TODO@eamodio: We are currently storing nothing or way too much in serialized state. We should start storing maybe both "client" and "server" state
			// Where as right now our webviews are only saving "client" state, e.g. the entire state sent to the webview, rather than key pieces of state
			// We probably need to separate state into actual "state" and all the data that is sent to the webview, e.g. for the Graph state might be the selected repo, selected sha, etc vs the entire data set to render the Graph
			serializedPanel = panel;
			if (state != null) {
				await show({ column: panel.viewColumn, preserveFocus: true }, { state: state });
			} else {
				await show({ column: panel.viewColumn, preserveFocus: true });
			}
		}

		const disposable = Disposable.from(
			...disposables,
			window.registerWebviewPanelSerializer(descriptor.id, {
				deserializeWebviewPanel: deserializeWebviewPanel,
			}),
			registerCommand(command, (...args) => show(undefined, ...args), this),
		);
		this.disposables.push(disposable);
		return {
			id: descriptor.id,
			get ready() {
				return registration.controller?.ready ?? false;
			},
			get visible() {
				return registration.controller?.visible ?? false;
			},
			dispose: function () {
				disposable.dispose();
			},
			close: () => void registration.controller?.parent.dispose(),
			refresh: async force => registration.controller?.refresh(force),
			show: show,
		} satisfies WebviewPanelProxy;
	}
}

export function isSerializedState<State>(o: unknown): o is { state: Partial<State> } {
	return o != null && typeof o === 'object' && 'state' in o && o.state != null && typeof o.state === 'object';
}
