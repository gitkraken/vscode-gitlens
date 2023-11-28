// NOTE@eamodio This file is referenced in the webviews to we can't use anything vscode or other imports that aren't available in the webviews
import { getDateDifference } from '../../../system/date';
import type { Organization } from './organization';

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

export const enum SubscriptionState {
	/** Indicates a user who hasn't verified their email address yet */
	VerificationRequired = -1,
	/** Indicates a Free user who hasn't yet started the preview trial */
	Free = 0,
	/** Indicates a Free user who is in preview trial */
	FreeInPreviewTrial,
	/** Indicates a Free user who's preview has expired trial */
	FreePreviewTrialExpired,
	/** Indicates a Free+ user with a completed trial */
	FreePlusInTrial,
	/** Indicates a Free+ user who's trial has expired */
	FreePlusTrialExpired,
	/** Indicates a Paid user */
	Paid,
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

			case SubscriptionPlanId.FreePlus:
				return SubscriptionState.FreePlusTrialExpired;

			case SubscriptionPlanId.Pro:
			case SubscriptionPlanId.Teams:
			case SubscriptionPlanId.Enterprise:
				return SubscriptionState.Paid;
		}
	}

	switch (effective.id) {
		case SubscriptionPlanId.Free:
			return preview == null ? SubscriptionState.Free : SubscriptionState.FreeInPreviewTrial;

		case SubscriptionPlanId.FreePlus:
			return SubscriptionState.FreePlusTrialExpired;

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
): SubscriptionPlan {
	return {
		id: id,
		name: getSubscriptionPlanName(id),
		bundle: bundle,
		cancelled: cancelled,
		organizationId: organizationId,
		trialReactivationCount: trialReactivationCount,
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

export function getSubscriptionStatePlanName(state: SubscriptionState | undefined, id: SubscriptionPlanId | undefined) {
	switch (state) {
		case SubscriptionState.FreePlusTrialExpired:
			return getSubscriptionPlanName(SubscriptionPlanId.FreePlus);
		case SubscriptionState.FreeInPreviewTrial:
			return `${getSubscriptionPlanName(SubscriptionPlanId.Pro)} (Trial)`;
		case SubscriptionState.FreePlusInTrial:
			return `${getSubscriptionPlanName(id ?? SubscriptionPlanId.Pro)} (Trial)`;
		case SubscriptionState.VerificationRequired:
			return `GitKraken (Unverified)`;
		case SubscriptionState.Paid:
			return getSubscriptionPlanName(id ?? SubscriptionPlanId.Pro);
		case SubscriptionState.Free:
		case SubscriptionState.FreePreviewTrialExpired:
		case null:
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
	return expiresOn != null ? getDateDifference(Date.now(), new Date(expiresOn), unit) : undefined;
}

export function isSubscriptionPaid(subscription: Optional<Subscription, 'state'>): boolean {
	return isSubscriptionPaidPlan(subscription.plan.effective.id);
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
