/*global window document*/
import { SignalWatcher } from '@lit-labs/signals';
import { provide } from '@lit/context';
import { html, LitElement } from 'lit';
import { property } from 'lit/decorators.js';
import { fromBase64ToString } from '@gitlens/utils/base64.js';
import type { GlWebviewCommands } from '../../../constants.commands.js';
import type { WebviewIds, WebviewTypes } from '../../../constants.views.js';
import { createWebviewCommandLink } from '../../../system/webview.js';
import type { WebviewState } from '../../protocol.js';
import { GlElement } from './components/element.js';
import { loggerContext, LoggerContext } from './contexts/logger.js';
import { PromosContext, promosContext } from './contexts/promos.js';
import type { WebviewContext } from './contexts/webview.js';
import { webviewContext } from './contexts/webview.js';
import { DOM } from './dom.js';
import type { Disposable } from './events.js';
import { createFocusTracker } from './focus.js';
import type { WebviewRpc } from './rpc/rpcController.js';
import { telemetryEventName } from './telemetry.js';
import type { ThemeChangeEvent } from './theme.js';
import { computeThemeColors, onDidChangeTheme, watchThemeColors } from './theme.js';

/**
 * Base class for webview applications.
 *
 * Provides all shared infrastructure that webview apps need:
 * - 3 Lit context providers (logger, promos, webview)
 * - Focus tracking (debounced notifications to host, via the app's `_rpc` controller)
 * - Telemetry bridging (`emitTelemetrySentEvent` DOM events → RPC)
 * - Theme color computation and change handling
 * - Preload class removal
 *
 * Host→webview focus/visibility pushes are dispatched by `RpcController`'s core subscription —
 * window CustomEvents plus the controller's `onWebviewFocusChanged`/`onWebviewVisibilityChanged`
 * option callbacks, which app-level overrides hook into.
 *
 * Subclasses initialize `this._webview` by calling `initWebviewContext()`
 * in their own `connectedCallback()` after `super.connectedCallback()`.
 */
export abstract class GlWebviewApp extends GlElement {
	static override shadowRootOptions: ShadowRootInit = {
		...LitElement.shadowRootOptions,
		delegatesFocus: true,
	};

	@property({ type: String }) name!: string;
	@property({ type: String }) placement: 'editor' | 'view' | 'panel' = 'editor';

	@provide({ context: loggerContext })
	protected _logger!: LoggerContext;

	@provide({ context: promosContext })
	protected _promos!: PromosContext;

	@provide({ context: webviewContext })
	protected _webview!: WebviewContext;

	/** The app's RPC controller — subclasses override with their own instance so the shared bridges
	 *  (telemetry DOM events, focus tracking) route through RPC. */
	protected _rpc?: WebviewRpc | undefined;

	protected onThemeUpdated?(e: ThemeChangeEvent): void;
	protected onWebviewFocusChanged?(focused: boolean): void;
	protected onWebviewVisibilityChanged?(visible: boolean): void;

	protected readonly disposables: Disposable[] = [];

	private _focusTracker?: ReturnType<typeof createFocusTracker>;

	/**
	 * Initializes `_webview` from a base64-encoded context string (the `#{state}` token value).
	 * Centralizes the `createCommandLink` logic used by all webviews.
	 */
	protected initWebviewContext(encodedContext: string): void {
		const parsed = JSON.parse(fromBase64ToString(encodedContext)) as WebviewState<WebviewIds>;
		const webviewId = parsed.webviewId;
		const webviewInstanceId = parsed.webviewInstanceId;
		this._webview = {
			webviewId: webviewId,
			webviewInstanceId: webviewInstanceId,
			createCommandLink: (command, args) => {
				if (command.endsWith(':')) {
					command = `${command}${webviewId.split('.').at(-1) as WebviewTypes}` as GlWebviewCommands;
				}
				return createWebviewCommandLink(command as GlWebviewCommands, webviewId, webviewInstanceId, args);
			},
		};
	}

	override connectedCallback(): void {
		super.connectedCallback?.();

		this._logger = new LoggerContext(this.name);
		this._logger.debug('connected');

		this.disposables.push(watchThemeColors());
		if (this.onThemeUpdated != null) {
			this.onThemeUpdated(computeThemeColors());
			this.disposables.push(onDidChangeTheme(this.onThemeUpdated, this));
		}

		this.disposables.push(
			(this._promos = new PromosContext()),
			// Forward `emitTelemetrySentEvent` DOM events to the host over RPC. Without this bridge
			// every `gl-telemetry-fired` event from a `GlWebviewApp`-based webview is silently dropped.
			DOM.on(window, telemetryEventName, e => {
				this._rpc?.sendTelemetry(e.detail);
			}),
		);

		// Focus tracking (sends debounced focus state to host for context keys)
		this._focusTracker = createFocusTracker(params => this._rpc?.sendFocusChanged(params));
		document.addEventListener('focusin', this._focusTracker.onFocusIn);
		document.addEventListener('focusout', this._focusTracker.onFocusOut);

		// Remove VS Code's default title attributes on <a> tags
		document.querySelectorAll('a').forEach(a => {
			if (a.href === a.title) {
				a.removeAttribute('title');
			}
		});

		// Remove preload class after delay to enable CSS transitions
		if (document.body.classList.contains('preload')) {
			setTimeout(() => {
				document.body.classList.remove('preload');
			}, 500);
		}
	}

	/** Backing cache for {@link consumeOneShotAttribute}. */
	private _oneShotAttributeRaw?: string;

	/** Cache-then-clear for a one-shot bootstrap/context attribute: VS Code can unmount/remount the
	 *  root element during startup (see RpcController's lifecycle contract), and the attribute is
	 *  only stamped once — a remount must re-read the cached copy, not parse `undefined`. Call with
	 *  the attribute's current value from `connectedCallback`, then clear the property. */
	protected consumeOneShotAttribute(value: string): string {
		this._oneShotAttributeRaw ??= value;
		return this._oneShotAttributeRaw;
	}

	override disconnectedCallback(): void {
		super.disconnectedCallback?.();

		this._logger.debug('disconnected');

		if (this._focusTracker != null) {
			document.removeEventListener('focusin', this._focusTracker.onFocusIn);
			document.removeEventListener('focusout', this._focusTracker.onFocusOut);
			this._focusTracker = undefined;
		}

		this.disposables.forEach(d => d.dispose());
		// Clear so a startup-churn remount doesn't retain (and later double-dispose) dead entries.
		this.disposables.length = 0;
	}

	override render(): unknown {
		return html`<slot></slot>`;
	}
}

// SignalWatcher mixin loses parent class type information (known TS issue with mixins).
// `GlWebviewApp` is abstract, so we first cast to a concrete constructor for `SignalWatcher`,
// then cast the result back to preserve `GlWebviewApp`'s type surface.
const _SignalWatcherBase = SignalWatcher(
	GlWebviewApp as unknown as new (...args: any[]) => GlWebviewApp,
) as unknown as typeof GlWebviewApp;

/**
 * Base class for RPC-only webviews that use Lit Signals for state management.
 * Readiness is announced over RPC: each mount's session (`RpcController` →
 * `connectRpcSession`) announces itself to the host, which exposes its services
 * in response — no separate readiness message is sent.
 */
export abstract class SignalWatcherWebviewApp extends _SignalWatcherBase {}
