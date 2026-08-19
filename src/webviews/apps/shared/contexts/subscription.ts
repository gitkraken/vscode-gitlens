import { signal as litSignal } from '@lit-labs/signals';
import { createContext } from '@lit/context';
import type { Subscription } from '../../../../plus/gk/models/subscription.js';
import type { AiUsageInfo, OrgSettings } from '../../../rpc/services/types.js';
import type { ReadableSignal } from '../state.js';

/** Subscription-related state provided by the host via RemoteSignals. */
export interface SubscriptionContextState {
	readonly subscription: ReadableSignal<Subscription | undefined>;
	readonly orgSettings: ReadableSignal<OrgSettings>;
	readonly avatar: ReadableSignal<string | undefined>;
	readonly hasAccount: ReadableSignal<boolean>;
	readonly organizationsCount: ReadableSignal<number>;
	/**
	 * GitKraken AI weekly usage. `undefined` = not yet resolved (the host seeds it asynchronously, so this
	 * is still a real state after connect); `null` = resolved but unavailable (signed out, on-premise org,
	 * or a failed fetch). Consumers render nothing for both.
	 */
	readonly aiUsage: ReadableSignal<AiUsageInfo | null | undefined>;
}

export const subscriptionContext = createContext<SubscriptionContextState>('subscription');

/** Default state with Signal.State instances (used before RPC connection). */
export function createDefaultSubscriptionContextState(): SubscriptionContextState {
	return {
		subscription: litSignal<Subscription | undefined>(undefined),
		orgSettings: litSignal<OrgSettings>({ ai: false, drafts: false }),
		avatar: litSignal<string | undefined>(undefined),
		hasAccount: litSignal<boolean>(false),
		organizationsCount: litSignal<number>(0),
		aiUsage: litSignal<AiUsageInfo | null | undefined>(undefined),
	};
}
