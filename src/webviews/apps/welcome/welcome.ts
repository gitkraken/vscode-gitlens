/*global*/
import './welcome.scss';
import type { Remote } from '@eamodio/supertalk';
import { provide } from '@lit/context';
import { html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { fromBase64ToString } from '@gitlens/utils/base64.js';
import { SubscriptionState } from '../../../constants.subscription.js';
import type { WelcomeServices } from '../../rpc/welcomeService.js';
import type { State } from '../../welcome/protocol.js';
import { noop } from '../shared/actions/rpc.js';
import { SignalWatcherWebviewApp } from '../shared/appBase.js';
import { scrollableBase } from '../shared/components/styles/lit/base.css.js';
import { subscribeAll } from '../shared/events/subscriptions.js';
import { getHost } from '../shared/host/context.js';
import { RpcController } from '../shared/rpc/rpcController.js';
import { SubscribeThenSeed } from '../shared/rpc/subscribeThenSeed.js';
import type { ThemeChangeEvent } from '../shared/theme.js';
import { createWelcomeState, welcomeStateContext } from './state.js';
import type { WelcomeState } from './state.js';
import { welcomeBaseStyles } from './welcome.css.js';
import './components/welcome-page.js';

@customElement('gl-welcome-app')
export class GlWelcomeApp extends SignalWatcherWebviewApp {
	static override styles = [scrollableBase, welcomeBaseStyles];

	private _host = getHost();

	/** Instance-owned ephemeral state — provided to descendants via context. */
	@provide({ context: welcomeStateContext })
	private _state: WelcomeState = createWelcomeState();

	@property({ type: String })
	webroot?: string;

	@state()
	private isLightTheme = false;

	/** Subscribe-then-seed choreography — released at disconnect and rerun per ready against the
	 *  new session (the subscriber closes over this mount's state). */
	private readonly _seed = new SubscribeThenSeed<WelcomeServices>();

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

		const context = this.consumeContext();

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
		// Also strands any seed still in flight from this mount — its deferred applications must
		// not touch anything after teardown.
		this._seed.reset();

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

		void telemetry.sendEvent('welcome/action', { name: 'shown' }, { source: 'welcome' }).catch(noop);

		// Subscribe to events FIRST so changes during the initial fetch aren't missed, then fetch and
		// apply the authoritative snapshot — see `SubscribeThenSeed`'s docs for why (buffered pushes
		// during the fetch, replayed after).
		await this._seed.run({
			connection: this._rpc.connection!,
			subscriber: async remoteServices => {
				const [subscription, walkthrough, welcome] = await Promise.all([
					remoteServices.subscription,
					remoteServices.walkthrough,
					remoteServices.welcome,
				]);

				return subscribeAll([
					() =>
						subscription.onSubscriptionChanged(sub => {
							this._seed.during(() => s.plusState.set(sub?.state ?? SubscriptionState.Community));
						}),
					// Live progress of both Get Started walkthroughs (single combined event)
					() =>
						walkthrough.onProgressChanged(progress => {
							this._seed.during(() => s.walkthroughProgress.set(progress));
						}),
					() =>
						welcome.onDidSwitchWalkthroughMode(({ mode }) => {
							this._seed.during(() => s.mode.set(mode));
						}),
					// Re-focus the active walkthrough when the view is shown again while loaded
					() =>
						welcome.onDidFocusWalkthrough(() => {
							window.dispatchEvent(new CustomEvent('gl-walkthrough-focus-command'));
						}),
				]);
			},
			seed: async () => {
				const [progress, sub] = await Promise.all([
					walkthrough.getProgress().catch((ex: unknown) => {
						noop(ex);
						return undefined;
					}),
					subscription.getSubscription(),
				]);
				return { progress: progress, sub: sub };
			},
			applySeed: ({ progress, sub }) => {
				if (progress != null) {
					s.walkthroughProgress.set(progress);
				}
				s.plusState.set(sub?.state ?? SubscriptionState.Community);
			},
		});
	}

	override render(): unknown {
		return html`
			<div class="welcome scrollable">
				<gl-welcome-page .webroot=${this.webroot} .isLightTheme=${this.isLightTheme}></gl-welcome-page>
			</div>
		`;
	}
}
