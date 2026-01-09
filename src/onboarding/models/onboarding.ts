export interface OnboardingItemDefinition<T = undefined> {
	readonly scope: 'global' | 'workspace';
	/** GitLens version when this schema was introduced. Bump when data structure changes */
	readonly schema?: `${number}.${number}.${number}`;
	/** GitLens version when/if this item should be re-shown if the user dismissed it before this version */
	readonly reshowAfter?: `${number}.${number}.${number}`;
	/** Type marker for the data shape - value is never used at runtime */
	readonly state?: T;
}

export interface OnboardingItem<T> {
	/** GitLens version of the stored data schema (for migrations) */
	schema?: `${number}.${number}.${number}`;

	/** ISO timestamp when dismissed */
	dismissedAt?: string;
	/** GitLens version when dismissed (e.g., "17.1.0") */
	dismissedVersion?: `${number}.${number}.${number}`;

	/** Item-specific metadata */
	state?: T;
}

export interface OnboardingStorage {
	/** Whether legacy storage keys have been migrated to this state */
	migrated?: boolean;
	/** Map of item ID to its state (envelope + data) */
	items: Record<string, OnboardingItem<unknown>>;
}
