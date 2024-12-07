export const proFeaturePreviewUsages = 3;
export const proFeaturePreviewUsageDurationInDays = 1;
export const proPreviewLengthInDays = 0;
export const proTrialLengthInDays = 14;

export type PromoKeys = 'gkholiday' | 'pro50';

export const enum SubscriptionPlanId {
	Community = 'community',
	CommunityWithAccount = 'community-with-account',
	Pro = 'pro',
	Teams = 'teams',
	Enterprise = 'enterprise',
}

// NOTE: Pay attention to gitlens:plus:state in the `package.json` when modifying this enum
// NOTE: This is reported in telemetry so we should NOT change the values
export const enum SubscriptionState {
	/** Indicates a user who hasn't verified their email address yet */
	VerificationRequired = -1,
	/** Indicates an account-less Community (free) user who hasn't started a Pro preview */
	Community = 0,
	/** Indicates an account-less Community (free) user who is in a Pro preview */
	ProPreview = 1,
	/** Indicates an account-less Community (free) user who's Pro preview has expired */
	ProPreviewExpired = 2,
	/** Indicates a Pro user who is in a Pro trial */
	ProTrial = 3,
	/** Indicates a Pro user who's Pro trial has expired, has an account, and is not yet eligible for reactivation */
	ProTrialExpired = 4,
	/** Indicated a Pro user who's Pro trial has expired, has an account, and is eligible for reactivation */
	ProTrialReactivationEligible = 5,
	/** Indicates a Pro/Teams/Enterprise paid user */
	Paid = 6,
}

export type SubscriptionStateString =
	| 'verification'
	| 'free'
	| 'preview'
	| 'preview-expired'
	| 'trial'
	| 'trial-expired'
	| 'trial-reactivation-eligible'
	| 'paid'
	| 'unknown';
