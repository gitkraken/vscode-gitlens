import { uuid } from '@env/crypto';
import type {
	CancellationToken,
	WebviewOptions,
	WebviewPanel,
	WebviewPanelOptions,
	WebviewView,
	WebviewViewResolveContext,
} from 'vscode';
import { Disposable, Uri, ViewColumn, window } from 'vscode';
import type { GlCommands } from '../constants.commands';
import type { TrackedUsageFeatures } from '../constants.telemetry';
import type { WebviewIds, WebviewTypes, WebviewViewIds, WebviewViewTypes } from '../constants.views';
import type { Container } from '../container';
import { ensurePlusFeaturesEnabled } from '../plus/gk/utils';
import { debug } from '../system/decorators/log';
import { find, first, map } from '../system/iterable';
import { Logger } from '../system/logger';
import { startLogScope } from '../system/logger.scope';
import { executeCoreCommand, registerCommand } from '../system/vscode/command';
import { WebviewCommandRegistrar } from './webviewCommandRegistrar';
import { WebviewController } from './webviewController';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from './webviewProvider';

export interface WebviewPanelDescriptor<ID extends WebviewIds> {
	id: ID;
	readonly fileName: string;
	readonly iconPath: string;
	readonly title: string;
	readonly contextKeyPrefix: `gitlens:webview:${WebviewTypes}`;
	readonly trackingFeature: TrackedUsageFeatures;
	readonly type: WebviewTypes;
	readonly plusFeature: boolean;
	readonly column?: ViewColumn;
	readonly webviewOptions?: WebviewOptions;
	readonly webviewHostOptions?: WebviewPanelOptions;

	readonly allowMultipleInstances?: boolean;
}

interface WebviewPanelRegistration<
	ID extends WebviewIds,
	State,
	SerializedState = State,
	ShowingArgs extends unknown[] = unknown[],
> {
	readonly descriptor: WebviewPanelDescriptor<ID>;
	controllers?: Map<string | undefined, WebviewController<ID, State, SerializedState, ShowingArgs>> | undefined;
}

export interface WebviewPanelProxy<
	ID extends WebviewIds,
	ShowingArgs extends unknown[] = unknown[],
	SerializedState = unknown,
> extends Disposable {
	readonly id: ID;
	readonly instanceId: string | undefined;
	readonly ready: boolean;
	readonly active: boolean;
	readonly visible: boolean;
	canReuseInstance(
		options?: WebviewPanelShowOptions,
		...args: WebviewShowingArgs<ShowingArgs, SerializedState>
	): boolean | undefined;
	close(): void;
	refresh(force?: boolean): Promise<void>;
	show(options?: WebviewPanelShowOptions, ...args: WebviewShowingArgs<ShowingArgs, SerializedState>): Promise<void>;
}

export interface WebviewPanelsProxy<
	ID extends WebviewIds,
	ShowingArgs extends unknown[] = unknown[],
	SerializedState = unknown,
> extends Disposable {
	readonly id: ID;
	readonly instances: Iterable<WebviewPanelProxy<ID, ShowingArgs, SerializedState>>;
	getActiveInstance(): WebviewPanelProxy<ID, ShowingArgs, SerializedState> | undefined;
	getBestInstance(
		options?: WebviewPanelShowOptions,
		...args: WebviewShowingArgs<ShowingArgs, SerializedState>
	): WebviewPanelProxy<ID, ShowingArgs, SerializedState> | undefined;
	show(options?: WebviewPanelsShowOptions, ...args: WebviewShowingArgs<ShowingArgs, SerializedState>): Promise<void>;
	splitActiveInstance(options?: WebviewPanelsShowOptions): Promise<void>;
}

export interface WebviewViewDescriptor<ID extends WebviewViewIds = WebviewViewIds> {
	id: ID;
	readonly fileName: string;
	readonly title: string;
	readonly contextKeyPrefix: `gitlens:webviewView:${WebviewViewTypes}`;
	readonly trackingFeature: TrackedUsageFeatures;
	readonly type: WebviewViewTypes;
	readonly plusFeature: boolean;
	readonly webviewOptions?: WebviewOptions;
	readonly webviewHostOptions?: {
		readonly retainContextWhenHidden?: boolean;
	};
}

interface WebviewViewRegistration<
	ID extends WebviewViewIds,
	State,
	SerializedState = State,
	ShowingArgs extends unknown[] = unknown[],
> {
	readonly descriptor: WebviewViewDescriptor<ID>;
	controller?: WebviewController<ID, State, SerializedState, ShowingArgs>;
	pendingShowArgs?:
		| [WebviewViewShowOptions | undefined, WebviewShowingArgs<ShowingArgs, SerializedState>]
		| undefined;
}

export interface WebviewViewProxy<ID extends WebviewViewIds, ShowingArgs extends unknown[], SerializedState = unknown>
	extends Disposable {
	readonly id: ID;
	readonly ready: boolean;
	readonly visible: boolean;
	refresh(force?: boolean): Promise<void>;
	show(options?: WebviewViewShowOptions, ...args: WebviewShowingArgs<ShowingArgs, SerializedState>): Promise<void>;
}

export class WebviewsController implements Disposable {
	private readonly disposables: Disposable[] = [];
	private readonly _commandRegistrar: WebviewCommandRegistrar;
	private readonly _panels = new Map<string, WebviewPanelRegistration<WebviewIds, any>>();
	private readonly _views = new Map<string, WebviewViewRegistration<WebviewViewIds, any>>();

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
		singleLine: true,
	})
	registerWebviewView<
		ID extends WebviewViewIds,
		State,
		SerializedState = State,
		ShowingArgs extends unknown[] = unknown[],
	>(
		descriptor: WebviewViewDescriptor<ID>,
		resolveProvider: (
			container: Container,
			host: WebviewHost<ID>,
		) => Promise<WebviewProvider<State, SerializedState, ShowingArgs>>,
		onBeforeShow?: (...args: WebviewShowingArgs<ShowingArgs, SerializedState>) => void | Promise<void>,
	): WebviewViewProxy<ID, ShowingArgs, SerializedState> {
		using scope = startLogScope(`WebviewView(${descriptor.id})`, false);

		const registration: WebviewViewRegistration<ID, State, SerializedState, ShowingArgs> = {
			descriptor: descriptor,
		};
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
						if (registration.descriptor.plusFeature) {
							if (!(await ensurePlusFeaturesEnabled())) return;
							if (token.isCancellationRequested) return;
						}

						Logger.debug(scope, 'Resolving view');

						webviewView.webview.options = {
							enableCommandUris: true,
							enableScripts: true,
							localResourceRoots: [Uri.file(this.container.context.extensionPath)],
							...descriptor.webviewOptions,
						};

						webviewView.title = descriptor.title;

						const controller = await WebviewController.create<ID, State, SerializedState, ShowingArgs>(
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
								Logger.debug(scope, 'Disposing view');

								registration.pendingShowArgs = undefined;
								registration.controller = undefined;
							}),
							controller,
						);

						let [options, args] = registration.pendingShowArgs ?? [];
						registration.pendingShowArgs = undefined;
						if (args == null && isSerializedState<State>(context)) {
							args = [{ state: context.state }];
						}

						Logger.debug(scope, 'Showing view');
						await controller.show(true, options, ...(args ?? []));
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
			show: async function (
				options?: WebviewViewShowOptions,
				...args: WebviewShowingArgs<ShowingArgs, SerializedState>
			) {
				Logger.debug(scope, 'Showing view');

				if (registration.controller != null) {
					return registration.controller.show(false, options, ...args);
				}

				registration.pendingShowArgs = [options, args];

				if (onBeforeShow != null) {
					await onBeforeShow?.(...args);
				}

				return void executeCoreCommand(`${descriptor.id}.focus`, options);
			},
		} satisfies WebviewViewProxy<ID, ShowingArgs, SerializedState>;
	}

	@debug<WebviewsController['registerWebviewPanel']>({
		args: {
			0: c => c.id,
			1: d => d.id,
			2: false,
			3: false,
		},
		singleLine: true,
	})
	registerWebviewPanel<
		ID extends WebviewIds,
		State,
		SerializedState = State,
		ShowingArgs extends unknown[] = unknown[],
	>(
		command: {
			id: GlCommands;
			options?: WebviewPanelsShowOptions;
		},
		descriptor: WebviewPanelDescriptor<ID>,
		resolveProvider: (
			container: Container,
			host: WebviewHost<ID>,
		) => Promise<WebviewProvider<State, SerializedState, ShowingArgs>>,
	): WebviewPanelsProxy<ID, ShowingArgs, SerializedState> {
		using scope = startLogScope(`WebviewPanel(${descriptor.id})`, false);

		const registration: WebviewPanelRegistration<ID, State, SerializedState, ShowingArgs> = {
			descriptor: descriptor,
		};
		this._panels.set(descriptor.id, registration);

		const disposables: Disposable[] = [];
		const { container, _commandRegistrar: commandRegistrar } = this;

		let serializedPanel: WebviewPanel | undefined;

		async function show(
			options?: WebviewPanelsShowOptions,
			...args: WebviewShowingArgs<ShowingArgs, SerializedState>
		): Promise<void> {
			const { descriptor } = registration;
			if (descriptor.plusFeature) {
				if (!(await ensurePlusFeaturesEnabled())) return;
			}

			void container.usage.track(`${descriptor.trackingFeature}:shown`).catch();

			let column = options?.column ?? descriptor.column ?? ViewColumn.Beside;
			// Only try to open beside if there is an active tab
			if (column === ViewColumn.Beside && window.tabGroups.activeTabGroup.activeTab == null) {
				column = ViewColumn.Active;
			}

			let controller = getBestController(registration, options, ...args);
			if (controller == null) {
				let panel: WebviewPanel;
				if (serializedPanel != null) {
					Logger.debug(scope, 'Restoring panel');

					panel = serializedPanel;
					serializedPanel = undefined;
				} else {
					Logger.debug(scope, 'Creating panel');

					panel = window.createWebviewPanel(
						descriptor.id,
						descriptor.title,
						{ viewColumn: column, preserveFocus: options?.preserveFocus ?? false },
						{
							enableCommandUris: true,
							enableScripts: true,
							localResourceRoots: [Uri.file(container.context.extensionPath)],
							...descriptor.webviewOptions,
							...descriptor.webviewHostOptions,
						},
					);
				}

				panel.iconPath = Uri.file(container.context.asAbsolutePath(descriptor.iconPath));

				controller = await WebviewController.create<ID, State, SerializedState, ShowingArgs>(
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
						Logger.debug(scope, `Disposing panel (${controller!.instanceId})`);

						registration.controllers?.delete(controller!.instanceId);
					}),
					controller,
				);

				Logger.debug(scope, `Showing panel (${controller.instanceId})`);
				await controller.show(true, options, ...args);
			} else {
				Logger.debug(scope, `Showing existing panel (${controller.instanceId})`);
				await controller.show(false, options, ...args);
			}
		}

		async function deserializeWebviewPanel(panel: WebviewPanel, state: SerializedState) {
			// TODO@eamodio: We are currently storing nothing or way too much in serialized state. We should start storing maybe both "client" and "server" state
			// Where as right now our webviews are only saving "client" state, e.g. the entire state sent to the webview, rather than key pieces of state
			// We probably need to separate state into actual "state" and all the data that is sent to the webview, e.g. for the Graph state might be the selected repo, selected sha, etc vs the entire data set to render the Graph
			serializedPanel = panel;
			Logger.debug(scope, `Deserializing panel state=${state != null ? '<state>' : 'undefined'}`);
			await show(
				{ column: panel.viewColumn, preserveFocus: true, preserveInstance: false },
				...(state != null ? [{ state: state }] : []),
			);
		}

		const disposable = Disposable.from(
			...disposables,
			window.registerWebviewPanelSerializer(descriptor.id, {
				deserializeWebviewPanel: deserializeWebviewPanel,
			}),
			registerCommand(
				command.id,
				(opts: WebviewPanelShowOptions | undefined, ...args: unknown[]) => {
					return show({ ...command.options, ...opts }, ...(args as ShowingArgs));
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
			getBestInstance: function (
				options?: WebviewPanelShowOptions,
				...args: WebviewShowingArgs<ShowingArgs, SerializedState>
			) {
				const controller = getBestController(registration, options, ...args);
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
		} satisfies WebviewPanelsProxy<ID, ShowingArgs, SerializedState>;
	}
}

export interface WebviewPanelShowOptions {
	column?: ViewColumn;
	preserveFocus?: boolean;
	preserveVisibility?: boolean;
}

interface WebviewPanelsShowOptions extends WebviewPanelShowOptions {
	preserveInstance?: string | boolean;
}

export type WebviewPanelShowCommandArgs = [WebviewPanelsShowOptions | undefined, ...args: unknown[]];

export interface WebviewViewShowOptions {
	column?: never;
	preserveFocus?: boolean;
	preserveVisibility?: boolean;
}

export type WebviewShowOptions = WebviewPanelShowOptions | WebviewViewShowOptions;

function convertToWebviewPanelProxy<
	ID extends WebviewIds,
	State,
	SerializedState,
	ShowingArgs extends unknown[] = unknown[],
>(
	controller: WebviewController<ID, State, SerializedState, ShowingArgs>,
): WebviewPanelProxy<ID, ShowingArgs, SerializedState> {
	return {
		id: controller.id,
		instanceId: controller.instanceId,
		ready: controller.ready,
		active: controller.active ?? false,
		visible: controller.visible,
		canReuseInstance: function (
			options?: WebviewPanelShowOptions,
			...args: WebviewShowingArgs<ShowingArgs, SerializedState>
		) {
			return controller.canReuseInstance(options, ...args);
		},
		close: function () {
			controller.parent.dispose();
		},
		dispose: function () {
			controller.dispose();
		},
		refresh: function (force?: boolean) {
			return controller.refresh(force);
		},
		show: function (options?: WebviewPanelShowOptions, ...args: WebviewShowingArgs<ShowingArgs, SerializedState>) {
			return controller.show(false, options, ...args);
		},
	};
}

function getBestController<ID extends WebviewIds, State, SerializedState, ShowingArgs extends unknown[]>(
	registration: WebviewPanelRegistration<ID, State, SerializedState, ShowingArgs>,
	options: WebviewPanelsShowOptions | undefined,
	...args: WebviewShowingArgs<ShowingArgs, SerializedState>
) {
	let controller;
	if (registration.controllers?.size) {
		if (registration.descriptor.allowMultipleInstances) {
			if (options?.preserveInstance !== false) {
				if (options?.preserveInstance != null && typeof options.preserveInstance === 'string') {
					controller = registration.controllers.get(options.preserveInstance);
				}

				if (controller == null) {
					let active;
					let first;

					// Sort active controllers first
					const sortedControllers = [...registration.controllers.values()].sort(
						(a, b) => (a.active ? -1 : 1) - (b.active ? -1 : 1),
					);

					for (const c of sortedControllers) {
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

	return controller;
}

export function isSerializedState<State>(o: unknown): o is { state: Partial<State> } {
	return o != null && typeof o === 'object' && 'state' in o && o.state != null && typeof o.state === 'object';
}
