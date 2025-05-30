import type {
	CancellationToken,
	WebviewOptions,
	WebviewPanelOptions,
	WebviewView,
	WebviewViewResolveContext,
} from 'vscode';
import { Disposable, Uri, ViewColumn, window } from 'vscode';
import type { Commands, WebviewIds, WebviewViewIds } from '../constants';
import type { Container } from '../container';
import { ensurePlusFeaturesEnabled } from '../plus/subscription/utils';
import { executeCommand, registerCommand } from '../system/command';
import type { TrackedUsageFeatures } from '../telemetry/usageTracker';
import type { WebviewProvider } from './webviewController';
import { WebviewController } from './webviewController';

export interface WebviewPanelDescriptor {
	id: `gitlens.${WebviewIds}`;
	readonly fileName: string;
	readonly iconPath: string;
	readonly title: string;
	readonly contextKeyPrefix: `gitlens:webview:${WebviewIds}`;
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
	readonly id: `gitlens.${WebviewIds}`;
	readonly ready: boolean;
	readonly visible: boolean;
	close(): void;
	refresh(force?: boolean): Promise<void>;
	show(options?: { column?: ViewColumn; preserveFocus?: boolean }, ...args: unknown[]): Promise<void>;
}

export interface WebviewViewDescriptor {
	id: `gitlens.views.${WebviewViewIds}`;
	readonly fileName: string;
	readonly title: string;
	readonly contextKeyPrefix: `gitlens:webviewView:${WebviewViewIds}`;
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
	readonly id: `gitlens.views.${WebviewViewIds}`;
	readonly ready: boolean;
	readonly visible: boolean;
	refresh(force?: boolean): Promise<void>;
	show(options?: { preserveFocus?: boolean }, ...args: unknown[]): Promise<void>;
}

export class WebviewsController implements Disposable {
	private readonly disposables: Disposable[] = [];
	private readonly _panels = new Map<string, WebviewPanelRegistration<any>>();
	private readonly _views = new Map<string, WebviewViewRegistration<any>>();

	constructor(private readonly container: Container) {}

	dispose() {
		this.disposables.forEach(d => void d.dispose());
	}

	registerWebviewView<State, SerializedState = State>(
		descriptor: WebviewViewDescriptor,
		resolveProvider: (
			container: Container,
			controller: WebviewController<State, SerializedState>,
		) => Promise<WebviewProvider<State, SerializedState>>,
		canResolveProvider?: () => boolean | Promise<boolean>,
	): WebviewViewProxy {
		const registration: WebviewViewRegistration<State, SerializedState> = { descriptor: descriptor };
		this._views.set(descriptor.id, registration);

		const disposables: Disposable[] = [];
		disposables.push(
			window.registerWebviewViewProvider(
				descriptor.id,
				{
					resolveWebviewView: async (
						webviewView: WebviewView,
						_context: WebviewViewResolveContext<SerializedState>,
						token: CancellationToken,
					) => {
						if (canResolveProvider != null) {
							if ((await canResolveProvider()) === false) return;
						}

						if (registration.descriptor.plusFeature) {
							if (!(await ensurePlusFeaturesEnabled())) return;
							if (token.isCancellationRequested) return;
						}

						webviewView.webview.options = {
							enableCommandUris: true,
							enableScripts: true,
							localResourceRoots: [Uri.file(this.container.context.extensionPath)],
							...descriptor.webviewOptions,
						};

						webviewView.title = descriptor.title;

						const controller = await WebviewController.create(
							this.container,
							descriptor,
							webviewView,
							resolveProvider,
						);
						registration.controller = controller;

						disposables.push(
							controller.onDidDispose(() => {
								registration.pendingShowArgs = undefined;
								registration.controller = undefined;
							}, this),
							controller,
						);

						if (registration.pendingShowArgs != null) {
							await controller.show(true, ...registration.pendingShowArgs);
							registration.pendingShowArgs = undefined;
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
				return registration.controller?.isReady ?? false;
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

				registration.pendingShowArgs = [options, ...args];
				return void executeCommand(`${descriptor.id}.focus`, options);
			},
		} satisfies WebviewViewProxy;
	}

	registerWebviewPanel<State, SerializedState = State>(
		command: Commands,
		descriptor: WebviewPanelDescriptor,
		resolveProvider: (
			container: Container,
			controller: WebviewController<State, SerializedState>,
		) => Promise<WebviewProvider<State, SerializedState>>,
		canResolveProvider?: () => boolean | Promise<boolean>,
	): WebviewPanelProxy {
		const registration: WebviewPanelRegistration<State, SerializedState> = { descriptor: descriptor };
		this._panels.set(descriptor.id, registration);

		const disposables: Disposable[] = [];
		const { container } = this;

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
				const panel = window.createWebviewPanel(
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
				panel.iconPath = Uri.file(container.context.asAbsolutePath(descriptor.iconPath));

				controller = await WebviewController.create(container, descriptor, panel, resolveProvider);
				registration.controller = controller;

				disposables.push(
					controller.onDidDispose(() => (registration.controller = undefined)),
					controller,
				);

				await controller.show(true, options, ...args);
			} else {
				await controller.show(false, options, ...args);
			}
		}

		const disposable = Disposable.from(
			...disposables,
			registerCommand(command, (...args) => show(undefined, ...args), this),
		);
		this.disposables.push(disposable);
		return {
			id: descriptor.id,
			get ready() {
				return registration.controller?.isReady ?? false;
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
