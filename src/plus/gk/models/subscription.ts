import type { SubscriptionState } from '../../../constants.subscription.js';
import type { Source } from '../../../constants.telemetry.js';
import type { Organization } from './organization.js';

export type SubscriptionPlanIds =
	| 'community'
	| 'community-with-account'
	| 'student'
	| 'pro'
	| 'advanced'
	| 'teams' /* the old name for Business; do not change */
	| 'enterprise';

export type FreeSubscriptionPlanIds = Extract<SubscriptionPlanIds, 'community' | 'community-with-account'>;
export type PaidSubscriptionPlanIds = Exclude<SubscriptionPlanIds, FreeSubscriptionPlanIds>;
export type RequiredSubscriptionPlanIds = Exclude<SubscriptionPlanIds, 'community'>;

export interface Subscription {
	readonly plan: {
		readonly actual: SubscriptionPlan;
		readonly effective: SubscriptionPlan;
	};
	account: SubscriptionAccount | undefined;

	state: SubscriptionState;

	lastValidatedAt?: number;

	readonly activeOrganization?: Organization;
}

export interface SubscriptionPlan {
	readonly id: SubscriptionPlanIds;
	readonly name: string;
	readonly bundle: boolean;
	readonly trialReactivationCount: number;
	readonly nextTrialOptInDate?: string | undefined;
	readonly cancelled: boolean;
	readonly startedOn: string;
	readonly expiresOn?: string | undefined;
	readonly organizationId: string | undefined;
}

export interface SubscriptionAccount {
	readonly id: string;
	readonly name: string;
	readonly email: string | undefined;
	readonly verified: boolean;
	readonly createdOn: string;
}

export interface SubscriptionUpgradeCommandArgs extends Source {
	plan?: PaidSubscriptionPlanIds;
}

export interface SubscriptionLoginCommandArgs extends Source {
	/** When `false`, suppresses opening the Account view during the login/sign-up flow — used where the
	 *  sign-in UI is already visible (e.g. the Commit Graph's access screen) and popping it is redundant. */
	openAccountView?: boolean;
}

export type SubscriptionStateString =
	| 'verification'
	| 'free'
	| 'trial'
	| 'trial-expired'
	| 'trial-reactivation-eligible'
	| 'paid'
	| 'unknown';
