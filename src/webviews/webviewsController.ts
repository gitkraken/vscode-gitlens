import type {
	CancellationToken,
	WebviewOptions,
	WebviewPanel,
	WebviewPanelOptions,
	WebviewView,
	WebviewViewResolveContext,
} from 'vscode';
import { Disposable, Uri, ViewColumn, window } from 'vscode';
import { uuid } from '@env/crypto';
import type { Commands, WebviewIds, WebviewTypes, WebviewViewIds, WebviewViewTypes } from '../constants';
import type { Container } from '../container';
import { ensurePlusFeaturesEnabled } from '../plus/subscription/utils';
import { executeCoreCommand, registerCommand } from '../system/command';
import { debug } from '../system/decorators/log';
import { find, first, map } from '../system/iterable';
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

	readonly allowMultipleInstances?: boolean;
}

interface WebviewPanelRegistration<State, SerializedState = State> {
	readonly descriptor: WebviewPanelDescriptor;
	controllers?:
		| Map<string | undefined, WebviewController<State, SerializedState, WebviewPanelDescriptor>>
		| undefined;
}

export interface WebviewPanelProxy extends Disposable {
	readonly id: WebviewIds;
	readonly instanceId: string | undefined;
	readonly ready: boolean;
	readonly active: boolean;
	readonly visible: boolean;
	close(): void;
	refresh(force?: boolean): Promise<void>;
	show(options?: WebviewPanelShowOptions, ...args: unknown[]): Promise<void>;
}

export interface WebviewPanelsProxy extends Disposable {
	readonly id: WebviewIds;
	readonly instances: Iterable<WebviewPanelProxy>;
	getActiveInstance(): WebviewPanelProxy | undefined;
	show(options?: WebviewPanelsShowOptions, ...args: unknown[]): Promise<void>;
	splitActiveInstance(options?: WebviewPanelsShowOptions): Promise<void>;
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
	show(options?: WebviewViewShowOptions, ...args: unknown[]): Promise<void>;
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
							undefined,
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
			refresh: function (force?: boolean) {
				return registration.controller != null ? registration.controller.refresh(force) : Promise.resolve();
			},
			show: function (options?: WebviewViewShowOptions, ...args: unknown[]) {
				if (registration.controller != null) {
					return registration.controller.show(false, options, ...args);
				}

				Logger.debug(scope, `Showing webview view (${descriptor.id})`);

				registration.pendingShowArgs = [options, ...args];
				return Promise.resolve(void executeCoreCommand(`${descriptor.id}.focus`, options));
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
		command: {
			id: Commands;
			options?: WebviewPanelsShowOptions;
		},
		descriptor: WebviewPanelDescriptor,
		resolveProvider: (
			container: Container,
			controller: WebviewController<State, SerializedState>,
		) => Promise<WebviewProvider<State, SerializedState>>,
		canResolveProvider?: () => boolean | Promise<boolean>,
	): WebviewPanelsProxy {
		const scope = getLogScope();

		const registration: WebviewPanelRegistration<State, SerializedState> = { descriptor: descriptor };
		this._panels.set(descriptor.id, registration);

		const disposables: Disposable[] = [];
		const { container, _commandRegistrar: commandRegistrar } = this;

		let serializedPanel: WebviewPanel | undefined;

		async function show(options?: WebviewPanelsShowOptions, ...args: unknown[]): Promise<void> {
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

			let controller: WebviewController<State, SerializedState, WebviewPanelDescriptor> | undefined;
			if (registration.controllers?.size) {
				if (descriptor.allowMultipleInstances) {
					if (options?.preserveInstance !== false) {
						if (options?.preserveInstance != null && typeof options.preserveInstance === 'string') {
							controller = registration.controllers.get(options.preserveInstance);
						}

						if (controller == null) {
							let active;
							let first;
							for (const c of registration.controllers.values()) {
								first ??= c;
								if (c.active) {
									active = c;
								}

								const canReuse = c.canReuseInstance(options, ...args);
								if (canReuse === true) {
									// If the webview says it should be reused, use it
									controller = c;
									break;
								} else if (canReuse === false) {
									// If the webview says it should not be reused don't and clear it from being first/active
									if (first === c) {
										first = undefined;
									}
									if (active === c) {
										active = undefined;
									}
								}
							}

							if (controller == null && options?.preserveInstance === true) {
								controller = active ?? first;
							}
						}
					}
				} else {
					controller = first(registration.controllers)?.[1];
				}
			}

			if (controller == null) {
				let panel: WebviewPanel;
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
					descriptor.allowMultipleInstances ? uuid() : undefined,
					panel,
					resolveProvider,
				);

				registration.controllers ??= new Map();
				registration.controllers.set(controller.instanceId, controller);

				disposables.push(
					controller.onDidDispose(() => {
						Logger.debug(scope, `Disposing webview panel (${descriptor.id})`);

						registration.controllers?.delete(controller!.instanceId);
					}),
					controller,
				);

				await controller.show(true, options, ...args);
			} else {
				Logger.debug(scope, `Showing webview panel (${descriptor.id}, ${controller.instanceId}})`);
				await controller.show(false, options, ...args);
			}
		}

		async function deserializeWebviewPanel(panel: WebviewPanel, state: SerializedState) {
			// TODO@eamodio: We are currently storing nothing or way too much in serialized state. We should start storing maybe both "client" and "server" state
			// Where as right now our webviews are only saving "client" state, e.g. the entire state sent to the webview, rather than key pieces of state
			// We probably need to separate state into actual "state" and all the data that is sent to the webview, e.g. for the Graph state might be the selected repo, selected sha, etc vs the entire data set to render the Graph
			serializedPanel = panel;
			if (state != null) {
				await show(
					{ column: panel.viewColumn, preserveFocus: true, preserveInstance: false },
					{ state: state },
				);
			} else {
				await show({ column: panel.viewColumn, preserveFocus: true, preserveInstance: false });
			}
		}

		const disposable = Disposable.from(
			...disposables,
			window.registerWebviewPanelSerializer(descriptor.id, {
				deserializeWebviewPanel: deserializeWebviewPanel,
			}),
			registerCommand(
				command.id,
				(...args: unknown[]) => {
					if (hasWebviewPanelShowOptions(args)) {
						const [{ _type, ...opts }, ...rest] = args;
						return show({ ...command.options, ...opts }, ...rest);
					}

					return show({ ...command.options }, ...args);
				},
				this,
			),
		);
		this.disposables.push(disposable);
		return {
			id: descriptor.id,
			get instances() {
				if (!registration.controllers?.size) return [];

				return map(registration.controllers.values(), c => convertToWebviewPanelProxy(c));
			},
			getActiveInstance: function () {
				if (!registration.controllers?.size) return undefined;

				const controller = find(registration.controllers.values(), c => c.active ?? false);
				return controller != null ? convertToWebviewPanelProxy(controller) : undefined;
			},
			splitActiveInstance: function (options?: WebviewPanelsShowOptions) {
				const controller =
					registration.controllers != null
						? find(registration.controllers.values(), c => c.active ?? false)
						: undefined;
				const args = controller?.getSplitArgs() ?? [];
				return show({ ...options, preserveInstance: false }, ...args);
			},
			dispose: function () {
				disposable.dispose();
			},
			show: show,
		} satisfies WebviewPanelsProxy;
	}
}

interface WebviewPanelShowOptions {
	column?: ViewColumn;
	preserveFocus?: boolean;
}

interface WebviewPanelsShowOptions extends WebviewPanelShowOptions {
	preserveInstance?: string | boolean;
}

export type WebviewPanelShowCommandArgs = [
	WebviewPanelsShowOptions & { _type: 'WebviewPanelShowOptions' },
	...args: unknown[],
];

interface WebviewViewShowOptions {
	column?: never;
	preserveFocus?: boolean;
}

export type WebviewShowOptions = WebviewPanelShowOptions | WebviewViewShowOptions;

function convertToWebviewPanelProxy<State, SerializedState>(
	controller: WebviewController<State, SerializedState, WebviewPanelDescriptor>,
): WebviewPanelProxy {
	return {
		id: controller.id,
		instanceId: controller.instanceId,
		ready: controller.ready,
		active: controller.active ?? false,
		visible: controller.visible,
		close: function () {
			controller.parent.dispose();
		},
		dispose: function () {
			controller.dispose();
		},
		refresh: function (force?: boolean) {
			return controller.refresh(force);
		},
		show: function (options?: WebviewPanelShowOptions, ...args: unknown[]) {
			return controller.show(false, options, ...args);
		},
	};
}

export function isSerializedState<State>(o: unknown): o is { state: Partial<State> } {
	return o != null && typeof o === 'object' && 'state' in o && o.state != null && typeof o.state === 'object';
}

function hasWebviewPanelShowOptions(args: unknown[]): args is WebviewPanelShowCommandArgs {
	const [arg] = args;
	return arg != null && typeof arg === 'object' && '_type' in arg && arg._type === 'WebviewPanelShowOptions';
}
