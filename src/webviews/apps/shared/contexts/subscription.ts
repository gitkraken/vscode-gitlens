import { createContext } from '@lit/context';
import { signal as litSignal } from '@lit-labs/signals';
import type { Subscription } from '../../../../plus/gk/models/subscription.js';
import type { OrgSettings } from '../../../rpc/services/types.js';
import type { ReadableSignal } from '../state.js';

/** Subscription-related state provided by the host via RemoteSignals. */
export interface SubscriptionContextState {
	readonly subscription: ReadableSignal<Subscription | undefined>;
	readonly orgSettings: ReadableSignal<OrgSettings>;
	readonly avatar: ReadableSignal<string | undefined>;
	readonly hasAccount: ReadableSignal<boolean>;
	readonly organizationsCount: ReadableSignal<number>;
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
	};
}
