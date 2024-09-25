export type PromoKeys = 'launchpad' | 'launchpad-extended' | 'pro50';

export const enum SubscriptionPlanId {
	Free = 'free',
	FreePlus = 'free+',
	Pro = 'pro',
	Teams = 'teams',
	Enterprise = 'enterprise',
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
