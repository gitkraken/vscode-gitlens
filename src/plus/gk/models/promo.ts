import type { GlCommands } from '../../../constants.commands';
import type { SubscriptionState } from '../../../constants.subscription';
import type { PaidSubscriptionPlanIds } from './subscription';

export type PromoKeys = 'pro50' | (string & {});
export type PromoLocation = 'account' | 'badge' | 'gate' | 'home';
export type PromoPlans = PaidSubscriptionPlanIds;

export interface Promo {
	readonly key: PromoKeys;
	readonly code?: string;
	readonly plan: PromoPlans;
	readonly states?: SubscriptionState[];
	readonly expiresOn?: number;
	readonly startsOn?: number;

	readonly locations?: PromoLocation[];
	readonly content?: {
		readonly modal?: { readonly detail: string };
		readonly quickpick: { readonly detail: string };
		readonly webview?: {
			readonly info?: {
				readonly html?: string;
			};
			readonly link?: {
				readonly html: string;
				readonly title: string;
				readonly command?: GlCommands;
			};
		};
	};

	readonly percentile?: number;
}
