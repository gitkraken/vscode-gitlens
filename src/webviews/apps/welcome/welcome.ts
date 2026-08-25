/*global*/
import './welcome.scss';
import type { Remote, Subscription } from '@eamodio/supertalk';
import { subscribe } from '@eamodio/supertalk';
import { provide } from '@lit/context';
import { html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fromBase64ToString } from '@gitlens/utils/base64.js';
import { SubscriptionState } from '../../../constants.subscription.js';
import type { WelcomeServices } from '../../rpc/welcomeService.js';
import type { State } from '../../welcome/protocol.js';
import { noop } from '../shared/actions/rpc.js';
import { SeedBuffer } from '../shared/actions/seedBuffer.js';
import { SignalWatcherWebviewApp } from '../shared/appBase.js';
import { scrollableBase } from '../shared/components/styles/lit/base.css.js';
import { subscribeAll } from '../shared/events/subscriptions.js';
import { getHost } from '../shared/host/context.js';
import { RpcController } from '../shared/rpc/rpcController.js';
import type { ThemeChangeEvent } from '../shared/theme.js';
import { createWelcomeState, welcomeStateContext } from './state.js';
import type { WelcomeState } from './state.js';
import { welcomeBaseStyles } from './welcome.css.js';
import './components/welcome-page.js';

@customElement('gl-welcome-app')
export class GlWelcomeApp extends SignalWatcherWebviewApp {
	static override styles = [scrollableBase, welcomeBaseStyles];

	@property({ type: String, noAccessor: true })
	private context!: string;

	private _host = getHost();

	/** Instance-owned ephemeral state — provided to descendants via context. */
	@provide({ context: welcomeStateContext })
	private _state: WelcomeState = createWelcomeState();

	@property({ type: String })
	webroot?: string;

	@state()
	private isLightTheme = false;

	/**
	 * RPC event subscription — released at disconnect (the subscriber closes over this mount's
	 * state) and recreated per ready against the new session.
	 */
	private _eventsSubscription?: Subscription;

	/** Buffers event applications while the subscribe-then-query seed is in flight — see {@link SeedBuffer}. */
	private readonly _seedBuffer = new SeedBuffer();

	/** The resolved subscription service — set per ready; used to detect a mount that tore down
	 *  while the seed's queries were pending. */
	private _subscription?: Awaited<Remote<WelcomeServices>['subscription']>;

	protected override readonly _rpc = new RpcController<WelcomeServices>(this, {
		rpcOptions: {
			webviewId: () => this._webview?.webviewId,
			webviewInstanceId: () => this._webview?.webviewInstanceId,
			endpoint: () => this._host.createEndpoint(),
		},
		onReady: services => this._onRpcReady(services),
	});

	override connectedCallback(): void {
		super.connectedCallback?.();

		const context = this.consumeOneShotAttribute(this.context);
		this.context = undefined!;
		this.initWebviewContext(context);

		// Seed the static bootstrap metadata — fixed for this iframe load
		const metadata = JSON.parse(fromBase64ToString(context)) as State;
		this._state.mode.set(metadata.mode ?? 'main');
		this._state.hostAppName.set(metadata.hostAppName);
		this._state.welcomeTitle.set(metadata.welcomeTitle);
		this._state.mcpNeedsInstall.set(metadata.mcpNeedsInstall);
		this._state.mcpShowCleanupNotice.set(metadata.mcpShowCleanupNotice);
	}

	override disconnectedCallback(): void {
		// Unsubscribe before resetting state: the retained handle would otherwise re-issue its
		// subscriber — which closes over the reset state — on the next handshake. A fresh
		// subscription is created per ready anyway, so nothing is lost by releasing it here.
		this._eventsSubscription?.unsubscribe();
		this._eventsSubscription = undefined;
		this._subscription = undefined;
		// Strand any seed still in flight from this mount — its deferred applications must not
		// touch anything after teardown.
		this._seedBuffer.reset();

		this._state.resetAll();

		super.disconnectedCallback?.();
	}

	protected override onThemeUpdated(e: ThemeChangeEvent): void {
		this.isLightTheme = e.isLightTheme;
	}

	private async _onRpcReady(services: Remote<WelcomeServices>): Promise<void> {
		const s = this._state;

		this._promos.connect(this._rpc.connection!);

		const [subscription, walkthrough, telemetry] = await Promise.all([
			services.subscription,
			services.walkthrough,
			services.telemetry,
		]);
		this._subscription = subscription;

		void telemetry.sendEvent('welcome/action', { name: 'shown' }, { source: 'welcome' }).catch(noop);

		// Subscribe to events FIRST so changes during the initial fetch aren't missed — synchronous:
		// `subscribe()` buffers the wire subscribe until the connection's handshake completes.
		// Recreated per ready (not `??=`): the subscriber closes over this session's state —
		// see the equivalent note in commitDetails.ts.
		this._eventsSubscription?.unsubscribe();
		this._eventsSubscription = subscribe<WelcomeServices>(this._rpc.connection!, async remoteServices => {
			const [subscription, walkthrough, welcome] = await Promise.all([
				remoteServices.subscription,
				remoteServices.walkthrough,
				remoteServices.welcome,
			]);

			return subscribeAll([
				() =>
					subscription.onSubscriptionChanged(sub => {
						this._seedBuffer.during(() => s.plusState.set(sub?.state ?? SubscriptionState.Community));
					}),
				// Live progress of both Get Started walkthroughs (single combined event)
				() =>
					walkthrough.onProgressChanged(progress => {
						this._seedBuffer.during(() => s.walkthroughProgress.set(progress));
					}),
				() =>
					welcome.onDidSwitchWalkthroughMode(({ mode }) => {
						this._seedBuffer.during(() => s.mode.set(mode));
					}),
				// Re-focus the active walkthrough when the view is shown again while loaded
				() =>
					welcome.onDidFocusWalkthrough(() => {
						window.dispatchEvent(new CustomEvent('gl-walkthrough-focus-command'));
					}),
			]);
		});

		// Subscribe-then-query seed: `subscription.getSubscription()` and `walkthrough.getProgress()`
		// both await host-side work, so a push racing either one isn't necessarily older than its
		// response — buffer push applications from now (before waiting on the subscriptions to land,
		// matching the subscribe-before-fetch guarantee: `ready` settles once, so reconnects don't
		// re-wait), apply both responses directly, then replay the buffer.
		this._seedBuffer.start();
		await this._eventsSubscription.ready;

		// Initial fetches — the subscriptions above keep everything fresh afterwards
		const [progress, sub] = await Promise.all([
			walkthrough.getProgress().catch((ex: unknown) => {
				noop(ex);
				return undefined;
			}),
			subscription.getSubscription(),
		]);
		// This mount may have torn down while the queries were pending — a dead seed must not
		// apply (or drain) anything into whatever replaced it.
		if (this._subscription !== subscription) return;

		if (progress != null) {
			s.walkthroughProgress.set(progress);
		}
		s.plusState.set(sub?.state ?? SubscriptionState.Community);
		this._seedBuffer.drain();
	}

	override render(): unknown {
		return html`
			<div class="welcome scrollable">
				<gl-welcome-page .webroot=${this.webroot} .isLightTheme=${this.isLightTheme}></gl-welcome-page>
			</div>
		`;
	}
}
