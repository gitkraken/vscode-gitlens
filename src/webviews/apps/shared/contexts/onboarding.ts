import type { Signal } from '@lit-labs/signals';
import { createContext } from '@lit/context';
import { signalObject } from 'signal-utils/object';
import type { GraphWalkthroughProgress, WalkthroughProgress } from '../../../../constants.walkthroughs.js';
import { createSignalGroup } from '../state.js';

export type OnboardingKey = 'integrationBanner';

export interface OnboardingState {
	readonly banners: {
		integrationBanner: boolean;
		agentsBanner: boolean;
	};
	readonly walkthroughProgress: Signal.State<WalkthroughProgress | undefined>;
	readonly graphWalkthroughProgress: Signal.State<GraphWalkthroughProgress | undefined>;
	/** Dismiss a banner by key. No-op before RPC connects; wired by root component. */
	dismiss(key: OnboardingKey): void;
	/** Dismiss the walkthrough. No-op before RPC connects; wired by root component. */
	dismissWalkthrough(): void;
	resetAll(): void;
}

export type ActiveWalkthrough =
	| { readonly mode: 'main'; readonly progress: WalkthroughProgress }
	| { readonly mode: 'graph'; readonly progress: GraphWalkthroughProgress };

/**
 * The walkthrough the header surfaces: the main (GitLens) walkthrough until it completes, then the
 * graph walkthrough. Returns `undefined` when both are complete (or no data yet) so the header can
 * hide its pill — the account modal remains the full picture of both.
 */
export function getActiveWalkthrough(onboarding: OnboardingState): ActiveWalkthrough | undefined {
	const main = onboarding.walkthroughProgress.get();
	if (main != null && main.doneCount < main.allCount) return { mode: 'main', progress: main };

	const graph = onboarding.graphWalkthroughProgress.get();
	if (graph != null && graph.doneCount < graph.allCount) return { mode: 'graph', progress: graph };

	return undefined;
}

function noop(): void {}

export function createOnboardingState(): OnboardingState {
	const { signal, resetAll } = createSignalGroup();
	return {
		banners: signalObject({
			integrationBanner: false,
			agentsBanner: false,
		}),
		walkthroughProgress: signal<WalkthroughProgress | undefined>(undefined),
		graphWalkthroughProgress: signal<GraphWalkthroughProgress | undefined>(undefined),
		dismiss: noop,
		dismissWalkthrough: noop,
		resetAll: resetAll,
	};
}

export const onboardingContext = createContext<OnboardingState>('onboarding');
