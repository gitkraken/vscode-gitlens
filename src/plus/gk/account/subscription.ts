// NOTE@eamodio This file is referenced in the webviews to we can't use anything vscode or other imports that aren't available in the webviews
import { getDateDifference } from '../../../system/date';
import type { Organization } from './organization';

export const SubscriptionUpdatedUriPathPrefix = 'did-update-subscription';

export const enum SubscriptionPlanId {
	Free = 'free',
	FreePlus = 'free+',
	Pro = 'pro',
	Teams = 'teams',
	Enterprise = 'enterprise',
}

export type FreeSubscriptionPlans = Extract<SubscriptionPlanId, SubscriptionPlanId.Free | SubscriptionPlanId.FreePlus>;
export type PaidSubscriptionPlans = Exclude<SubscriptionPlanId, SubscriptionPlanId.Free | SubscriptionPlanId.FreePlus>;
export type RequiredSubscriptionPlans = Exclude<SubscriptionPlanId, SubscriptionPlanId.Free>;

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

// NOTE: Pay attention to gitlens:plus:state in package.json when modifying this enum
// NOTE: This is reported in telemetry so we should NOT change the values
export const enum SubscriptionState {
	/** Indicates a user who hasn't verified their email address yet */
	VerificationRequired = -1,
	/** Indicates a Free user who hasn't yet started the preview trial */
	Free = 0,
	/** Indicates a Free user who is in preview trial */
	FreeInPreviewTrial = 1,
	/** Indicates a Free user who's preview has expired trial */
	FreePreviewTrialExpired = 2,
	/** Indicates a Free+ user with a completed trial */
	FreePlusInTrial = 3,
	/** Indicates a Free+ user who's trial has expired and is not yet eligible for reactivation */
	FreePlusTrialExpired = 4,
	/** Indicated a Free+ user who's trial has expired and is eligible for reactivation */
	FreePlusTrialReactivationEligible = 5,
	/** Indicates a Paid user */
	Paid = 6,
}

export function getSubscriptionStateString(state: SubscriptionState | undefined): string {
	switch (state) {
		case SubscriptionState.VerificationRequired:
			return 'verification';
		case SubscriptionState.Free:
			return 'free';
		case SubscriptionState.FreeInPreviewTrial:
			return 'preview';
		case SubscriptionState.FreePreviewTrialExpired:
			return 'preview-expired';
		case SubscriptionState.FreePlusInTrial:
			return 'trial';
		case SubscriptionState.FreePlusTrialExpired:
			return 'trial-expired';
		case SubscriptionState.FreePlusTrialReactivationEligible:
			return 'trial-reactivation-eligible';
		case SubscriptionState.Paid:
			return 'paid';
		default:
			return 'unknown';
	}
}

export function computeSubscriptionState(subscription: Optional<Subscription, 'state'>): SubscriptionState {
	const {
		account,
		plan: { actual, effective },
		previewTrial: preview,
	} = subscription;

	if (account?.verified === false) return SubscriptionState.VerificationRequired;

	if (actual.id === effective.id) {
		switch (effective.id) {
			case SubscriptionPlanId.Free:
				return preview == null ? SubscriptionState.Free : SubscriptionState.FreePreviewTrialExpired;

			case SubscriptionPlanId.FreePlus: {
				if (effective.nextTrialOptInDate != null && new Date(effective.nextTrialOptInDate) < new Date()) {
					return SubscriptionState.FreePlusTrialReactivationEligible;
				}

				return SubscriptionState.FreePlusTrialExpired;
			}

			case SubscriptionPlanId.Pro:
			case SubscriptionPlanId.Teams:
			case SubscriptionPlanId.Enterprise:
				return SubscriptionState.Paid;
		}
	}

	switch (effective.id) {
		case SubscriptionPlanId.Free:
			return preview == null ? SubscriptionState.Free : SubscriptionState.FreeInPreviewTrial;

		case SubscriptionPlanId.FreePlus: {
			if (effective.nextTrialOptInDate != null && new Date(effective.nextTrialOptInDate) < new Date()) {
				return SubscriptionState.FreePlusTrialReactivationEligible;
			}

			return SubscriptionState.FreePlusTrialExpired;
		}

		case SubscriptionPlanId.Pro:
			return actual.id === SubscriptionPlanId.Free
				? SubscriptionState.FreeInPreviewTrial
				: SubscriptionState.FreePlusInTrial;

		case SubscriptionPlanId.Teams:
		case SubscriptionPlanId.Enterprise:
			return SubscriptionState.Paid;
	}
}

export function getSubscriptionPlan(
	id: SubscriptionPlanId,
	bundle: boolean,
	trialReactivationCount: number,
	organizationId: string | undefined,
	startedOn?: Date,
	expiresOn?: Date,
	cancelled: boolean = false,
	nextTrialOptInDate?: string,
): SubscriptionPlan {
	return {
		id: id,
		name: getSubscriptionPlanName(id),
		bundle: bundle,
		cancelled: cancelled,
		organizationId: organizationId,
		trialReactivationCount: trialReactivationCount,
		nextTrialOptInDate: nextTrialOptInDate,
		startedOn: (startedOn ?? new Date()).toISOString(),
		expiresOn: expiresOn != null ? expiresOn.toISOString() : undefined,
	};
}

export function getSubscriptionPlanName(id: SubscriptionPlanId) {
	switch (id) {
		case SubscriptionPlanId.FreePlus:
			return 'GitKraken Free';
		case SubscriptionPlanId.Pro:
			return 'GitKraken Pro';
		case SubscriptionPlanId.Teams:
			return 'GitKraken Teams';
		case SubscriptionPlanId.Enterprise:
			return 'GitKraken Enterprise';
		case SubscriptionPlanId.Free:
		default:
			return 'GitKraken';
	}
}

const plansPriority = new Map<SubscriptionPlanId | undefined, number>([
	[undefined, -1],
	[SubscriptionPlanId.Free, 0],
	[SubscriptionPlanId.FreePlus, 1],
	[SubscriptionPlanId.Pro, 2],
	[SubscriptionPlanId.Teams, 3],
	[SubscriptionPlanId.Enterprise, 4],
]);

export function getSubscriptionPlanPriority(id: SubscriptionPlanId | undefined): number {
	return plansPriority.get(id) ?? -1;
}

export function getSubscriptionTimeRemaining(
	subscription: Optional<Subscription, 'state'>,
	unit?: 'days' | 'hours' | 'minutes' | 'seconds',
): number | undefined {
	return getTimeRemaining(subscription.plan.effective.expiresOn, unit);
}

export function getTimeRemaining(
	expiresOn: string | undefined,
	unit?: 'days' | 'hours' | 'minutes' | 'seconds',
): number | undefined {
	return expiresOn != null ? getDateDifference(Date.now(), new Date(expiresOn), unit, Math.round) : undefined;
}

export function isSubscriptionPaid(subscription: Optional<Subscription, 'state'>): boolean {
	return isSubscriptionPaidPlan(subscription.plan.actual.id);
}

export function isSubscriptionPaidPlan(id: SubscriptionPlanId): id is PaidSubscriptionPlans {
	return id !== SubscriptionPlanId.Free && id !== SubscriptionPlanId.FreePlus;
}

export function isSubscriptionExpired(subscription: Optional<Subscription, 'state'>): boolean {
	const remaining = getSubscriptionTimeRemaining(subscription);
	return remaining != null && remaining <= 0;
}

export function isSubscriptionTrial(subscription: Optional<Subscription, 'state'>): boolean {
	return subscription.plan.actual.id !== subscription.plan.effective.id;
}

export function isSubscriptionInProTrial(subscription: Optional<Subscription, 'state'>): boolean {
	if (
		subscription.account == null ||
		!isSubscriptionTrial(subscription) ||
		isSubscriptionPreviewTrialExpired(subscription) === false
	) {
		return false;
	}

	const remaining = getSubscriptionTimeRemaining(subscription);
	return remaining != null ? remaining <= 0 : true;
}

export function isSubscriptionPreviewTrialExpired(subscription: Optional<Subscription, 'state'>): boolean | undefined {
	const remaining = getTimeRemaining(subscription.previewTrial?.expiresOn);
	return remaining != null ? remaining <= 0 : undefined;
}

export function isSubscriptionStatePaidOrTrial(state: SubscriptionState | undefined): boolean {
	if (state == null) return false;
	return (
		state === SubscriptionState.Paid ||
		state === SubscriptionState.FreeInPreviewTrial ||
		state === SubscriptionState.FreePlusInTrial
	);
}

export function isSubscriptionStateTrial(state: SubscriptionState | undefined): boolean {
	if (state == null) return false;
	return state === SubscriptionState.FreeInPreviewTrial || state === SubscriptionState.FreePlusInTrial;
}

export function hasAccountFromSubscriptionState(state: SubscriptionState | undefined): boolean {
	if (state == null) return false;
	return (
		state !== SubscriptionState.Free &&
		state !== SubscriptionState.FreePreviewTrialExpired &&
		state !== SubscriptionState.FreeInPreviewTrial
	);
}

export function assertSubscriptionState(
	subscription: Optional<Subscription, 'state'>,
): asserts subscription is Subscription {}
