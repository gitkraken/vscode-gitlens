import type { Remote } from '@eamodio/supertalk';
import type { ContextProvider } from '@lit/context';
import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import type { GraphServices } from '../../../plus/graph/graphService.js';
import { noop } from '../../shared/actions/rpc.js';
import type { createAIState } from '../../shared/contexts/ai.js';
import type { createIntegrationsState } from '../../shared/contexts/integrations.js';
import type { createOnboardingState } from '../../shared/contexts/onboarding.js';
import type { subscriptionContext } from '../../shared/contexts/subscription.js';
import { subscribeAll } from '../../shared/events/subscriptions.js';
import type { GraphLaunchpadState } from './graphLaunchpadState.js';

/** One-time-bound view of the host-owned stores the account-rollup/Launchpad bootstrap populates. Built
 *  ONCE by `<gl-graph-app>` as closures over itself; none of these run on a hot path. */
export type AccountLaunchpadHostDeps = {
	launchpadState(): GraphLaunchpadState;
	subscriptionCtx(): ContextProvider<typeof subscriptionContext>;
	integrationsState(): ReturnType<typeof createIntegrationsState>;
	aiState(): ReturnType<typeof createAIState>;
	onboardingState(): ReturnType<typeof createOnboardingState>;
	isConnected(): boolean;
	services(): Remote<GraphServices> | undefined;
};

/**
 * Starts and tears down the shared Launchpad pipeline and the account rollup contexts (issue #5411)
 * once the host's `services` resolve. Owns the subscriptions/coalescer lifecycle so
 * connected/disconnected stay symmetric; the state stores and context providers themselves remain
 * owned by the host element.
 *
 * NOTE: the account rollup wiring happens once per webview lifetime and drives walkthrough progress
 * through the graph walkthrough service's `{ main, graph }` progress.
 */
export class AccountLaunchpadController implements ReactiveController {
	/** A refresh requested while one was in flight; holds the requested `force`. */
	private _launchpadRefreshQueued: boolean | undefined;
	private _launchpadUnsubscribe: (() => void) | undefined;

	/** Coalesce `onLaunchpadChanged` bursts (pin/snooze/connection changes can fire several in a row). */
	private readonly _launchpadRefreshDebounced: Deferrable<() => void>;

	private _accountUnsubscribe: (() => void) | undefined;

	private readonly deps: AccountLaunchpadHostDeps;

	constructor(controllerHost: ReactiveControllerHost, deps: AccountLaunchpadHostDeps) {
		this.deps = deps;
		this._launchpadRefreshDebounced = debounce(() => void this.refreshLaunchpadSummary(), 500);
		controllerHost.addController(this);
	}

	hostDisconnected(): void {
		this._launchpadUnsubscribe?.();
		this._launchpadUnsubscribe = undefined;
		this._launchpadRefreshDebounced.cancel();

		this._accountUnsubscribe?.();
		this._accountUnsubscribe = undefined;
	}

	/** Starts the shared Launchpad pipeline once `services` resolves: subscribes to host-side
	 *  change notifications (debounced refetch) and kicks off a deferred initial fetch. */
	async initLaunchpad(services: Remote<GraphServices>): Promise<void> {
		try {
			this._launchpadUnsubscribe = await subscribeAll([
				async () => {
					const launchpad = await services.launchpad;
					return launchpad.onLaunchpadChanged(() => this._launchpadRefreshDebounced());
				},
			]);
		} catch {
			// A failed subscription shouldn't break the graph — counts just won't auto-refresh.
		}
		// Defer the initial fetch off the cold graph-load path.
		setTimeout(() => void this.refreshLaunchpadSummary(), 0);
	}

	/** Populates the account rollup contexts once `services` resolves (issue #5411). Swaps the
	 *  subscription context to the host-side RemoteSignals, seeds the initial integrations/AI
	 *  state, and subscribes to change events. A failed subscription must not break the graph. */
	async initAccountContexts(services: Remote<GraphServices>): Promise<void> {
		const integrationsState = this.deps.integrationsState();
		const aiState = this.deps.aiState();
		const onboardingState = this.deps.onboardingState();
		const subscriptionCtx = this.deps.subscriptionCtx();

		// Wiring the account bar must never break the graph, so guard the whole pipeline: a rejected
		// service promise or a failed subscription just leaves the bar without live state.
		try {
			const [subscription, integrations, ai, walkthrough] = await Promise.all([
				services.subscription,
				services.integrations,
				services.ai,
				services.walkthrough,
			]);

			// Swap the subscription context to use the host-side RemoteSignals directly (no copy).
			// Supertalk proxy properties are thenable at runtime.
			/* eslint-disable @typescript-eslint/await-thenable -- Supertalk proxy properties are thenable at runtime */
			const [
				subscriptionSignal,
				orgSettingsSignal,
				avatarSignal,
				hasAccountSignal,
				orgCountSignal,
				aiUsageSignal,
			] = await Promise.all([
				subscription.subscriptionState,
				subscription.orgSettingsState,
				subscription.avatarState,
				subscription.hasAccountState,
				subscription.organizationsCountState,
				subscription.aiUsageState,
			]);
			/* eslint-enable @typescript-eslint/await-thenable */
			subscriptionCtx.setValue(
				{
					subscription: subscriptionSignal,
					orgSettings: orgSettingsSignal,
					avatar: avatarSignal,
					hasAccount: hasAccountSignal,
					organizationsCount: orgCountSignal,
					aiUsage: aiUsageSignal,
				},
				true,
			);

			// Seed initial integrations + AI state (the change subscriptions below only fire on change).
			// `.catch(noop)` also swallows any error thrown inside the success callback (not just a
			// rejected promise), which the 2nd-arg handler wouldn't.
			void integrations
				.getIntegrationStates()
				.then(s => {
					integrationsState.integrations.set(s);
					integrationsState.hasAnyIntegrationConnected.set(s.some(i => i.connected));
				})
				.catch(noop);
			void ai
				.getModel()
				.then(m => aiState.model.set(m))
				.catch(noop);
			void ai
				.getState()
				.then(s => aiState.state.set(s))
				.catch(noop);

			// Seed the walkthrough progress signals (main 7-step + graph 6-step) so the header pills and
			// account modal render immediately; the subscription below keeps them live.
			void walkthrough
				.getProgress()
				.then(p => {
					onboardingState.walkthroughProgress.set(p?.main);
					onboardingState.graphWalkthroughProgress.set(p?.graph);
				})
				.catch(noop);

			// Subscribe to host-side change events so the bar stays live.
			const unsubscribe = await subscribeAll([
				async () =>
					integrations.onIntegrationsChanged(data => {
						integrationsState.hasAnyIntegrationConnected.set(data.hasAnyConnected);
						integrationsState.integrations.set(data.integrations);
					}),
				async () => ai.onModelChanged(model => aiState.model.set(model)),
				async () => ai.onStateChanged(state => aiState.state.set(state)),
				async () =>
					walkthrough.onProgressChanged(p => {
						onboardingState.walkthroughProgress.set(p.main);
						onboardingState.graphWalkthroughProgress.set(p.graph);
					}),
			]);

			// Guard against late completion: if the element disconnected (`disconnectedCallback`) while we
			// were awaiting, tear down rather than store an orphaned subscription that would leak its host
			// change-event traffic.
			if (!this.deps.isConnected()) {
				unsubscribe?.();
				return;
			}

			this._accountUnsubscribe = unsubscribe;
		} catch {
			// The account bar is non-critical — swallow so wiring failures never break the graph.
		}
	}

	/** Fetches the Launchpad summary into the shared store. Connection-gated: probes integration
	 *  connection first (cheap) and skips the expensive `getSummary` categorize when nothing is
	 *  connected, so opening the graph without integrations costs nothing. The `plug` state in the
	 *  header indicator is driven by `connected === false`. */
	async refreshLaunchpadSummary(force?: boolean): Promise<void> {
		const services = this.deps.services();
		if (services == null) return;

		const launchpadState = this.deps.launchpadState();
		// Queue rather than drop — losing a user-initiated refresh to an in-flight one reads as a dead button
		if (launchpadState.loading.get()) {
			this._launchpadRefreshQueued = (this._launchpadRefreshQueued ?? false) || (force ?? false);
			return;
		}

		launchpadState.loading.set(true);
		try {
			const integrations = await services.integrations;
			const states = await integrations.getIntegrationStates();
			const connected = states?.some(i => i.connected) ?? false;
			launchpadState.connected.set(connected);
			if (!connected) {
				launchpadState.summary.set(undefined);
				return;
			}

			const launchpad = await services.launchpad;
			launchpadState.summary.set(await launchpad.getSummary(force ? { force: true } : undefined));
		} catch (ex) {
			const error = ex instanceof Error ? ex : new Error(String(ex));
			launchpadState.summary.set({ error: { name: error.name, message: error.message } });
		} finally {
			launchpadState.loading.set(false);

			const queued = this._launchpadRefreshQueued;
			if (queued != null) {
				this._launchpadRefreshQueued = undefined;
				void this.refreshLaunchpadSummary(queued);
			}
		}
	}
}
