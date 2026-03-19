/**
 * RPC controller for webview apps.
 *
 * Implements Lit's ReactiveController pattern for managing the RPC lifecycle:
 * - Automatic RPC connection on hostConnected (component mount)
 * - Automatic disposal on hostDisconnected (component unmount)
 *
 * Usage:
 * ```typescript
 * import { RpcController } from '../shared/rpc/rpcController.js';
 *
 * @customElement('my-app')
 * export class MyApp extends SignalWatcher(LitElement) {
 *   private _rpc = new RpcController<MyServices>(this, {
 *     onReady: services => this._onRpcReady(services),
 *     onError: error => console.error(error),
 *   });
 *
 *   private async _onRpcReady(services: Remote<MyServices>): Promise<void> {
 *     // Called when RPC connection is established
 *     // Set up subscriptions, fetch initial state, etc.
 *   }
 * }
 * ```
 */
import type { Remote } from '@eamodio/supertalk';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import { Logger } from '@gitlens/utils/logger.js';
import type { RpcClientOptions } from '../rpcClient.js';
import { wrapServices } from '../rpcClient.js';

export interface RpcControllerOptions<TServices extends object> {
	/**
	 * Called when RPC connection is established.
	 * Set up subscriptions, fetch initial state, etc.
	 *
	 * @param services - The RPC services proxy
	 */
	onReady?: (services: Remote<TServices>) => void | Promise<void>;

	/**
	 * Called when RPC connection fails.
	 *
	 * @param error - The error that occurred
	 */
	onError?: (error: Error) => void;

	/**
	 * Options passed to the underlying RPC client.
	 */
	rpcOptions?: RpcClientOptions;
}

/**
 * Lit ReactiveController that manages the RPC connection lifecycle.
 *
 * The controller:
 * - Establishes RPC connection in hostConnected
 * - Disposes connection in hostDisconnected
 * - Calls onReady when connection is established
 * - Calls onError if connection fails
 */
export class RpcController<TServices extends object> implements ReactiveController {
	private _services?: Remote<TServices>;
	private _disposeRpc?: () => void;
	private _connectionAbort?: AbortController;

	/**
	 * The RPC services proxy. Available after connection is established.
	 */
	get services(): Remote<TServices> | undefined {
		return this._services;
	}

	constructor(
		private readonly host: ReactiveControllerHost,
		private readonly options?: RpcControllerOptions<TServices>,
	) {
		host.addController(this);
	}

	hostConnected(): void {
		this._connectionAbort?.abort();
		this._connectionAbort = new AbortController();
		void this._connect(this._connectionAbort.signal);
	}

	hostDisconnected(): void {
		this._connectionAbort?.abort();
		this._connectionAbort = undefined;
		this._disposeRpc?.();
		this._disposeRpc = undefined;
		this._services = undefined;
	}

	private async _connect(signal: AbortSignal): Promise<void> {
		try {
			const { services, dispose } = await wrapServices<TServices>({
				...this.options?.rpcOptions,
				signal: signal,
			});

			if (signal.aborted) {
				dispose();
				return;
			}

			this._services = services;
			this._disposeRpc = dispose;

			if (this.options?.onReady != null) {
				try {
					await this.options.onReady(services);
				} catch (ex) {
					dispose();
					this._disposeRpc = undefined;
					this._services = undefined;
					throw ex;
				}
			}
		} catch (ex) {
			if (signal.aborted) return;

			const error = ex instanceof Error ? ex : new Error(String(ex));
			Logger.error(error, 'RpcController: Failed to connect');

			if (this.options?.onError != null) {
				this.options.onError(error);
			}
		}
	}
}
