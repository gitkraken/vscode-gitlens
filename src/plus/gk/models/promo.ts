import type { PromoKeys, SubscriptionState } from '../../../constants.subscription';

export type PromoLocation = 'account' | 'badge' | 'gate' | 'home';

export interface Promo {
	readonly key: PromoKeys;
	readonly code?: string;
	readonly states?: SubscriptionState[];
	readonly expiresOn?: number;
	readonly startsOn?: number;

	readonly command?: {
		command?: `command:${string}`;
		tooltip: string;
	};
	readonly locations?: PromoLocation[];
	readonly quickpick: { detail: string };
}
