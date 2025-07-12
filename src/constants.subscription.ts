export const proFeaturePreviewUsages = 3;
export const proFeaturePreviewUsageDurationInDays = 1;
export const proTrialLengthInDays = 14;

// NOTE: Pay attention to gitlens:plus:state in the `package.json` when modifying this enum
// NOTE: This is reported in telemetry so we should NOT change the values
export const enum SubscriptionState {
	/** Indicates a user who hasn't verified their email address yet */
	VerificationRequired = -1,
	/** Indicates an account-less Community (free) user */
	Community = 0,
	/** @deprecated DO NOT USE */
	DeprecatedPreview = 1,
	/** @deprecated DO NOT USE */
	DeprecatedPreviewExpired = 2,
	/** Indicates a user who is in a trial */
	Trial = 3,
	/** Indicates a user who's trial has expired, has an account, and is not yet eligible for reactivation */
	TrialExpired = 4,
	/** Indicated a user who's trial has expired, has an account, and is eligible for reactivation */
	TrialReactivationEligible = 5,
	/** Indicates a paid user */
	Paid = 6,
}
