import type { SubscriptionPlanId, SubscriptionState } from '../../../constants.subscription';
import type { Source } from '../../../constants.telemetry';
import type { Organization } from './organization';

export type FreeSubscriptionPlans = Extract<
	SubscriptionPlanId,
	SubscriptionPlanId.Community | SubscriptionPlanId.CommunityWithAccount
>;
export type PaidSubscriptionPlans = Exclude<
	SubscriptionPlanId,
	SubscriptionPlanId.Community | SubscriptionPlanId.CommunityWithAccount
>;
export type RequiredSubscriptionPlans = Exclude<SubscriptionPlanId, SubscriptionPlanId.Community>;

export interface Subscription {
	readonly plan: {
		readonly actual: SubscriptionPlan;
		readonly effective: SubscriptionPlan;
	};
	account: SubscriptionAccount | undefined;
	previewTrial?: SubscriptionPreviewTrial;

	state: SubscriptionState;

	lastValidatedAt?: number;

	readonly activeOrganization?: Organization;
}

export interface SubscriptionPlan {
	readonly id: SubscriptionPlanId;
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

export interface SubscriptionPreviewTrial {
	readonly startedOn: string;
	readonly expiresOn: string;
}

export interface SubscriptionUpgradeCommandArgs extends Source {
	plan?: SubscriptionPlanId;
}
