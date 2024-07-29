export interface OnboardingStateTemplate {
	[key: `${string}Checked`]: boolean;
}

export interface OnboardingItemConfiguration<T extends string> {
	itemId: T;
	playHref?: string;
	infoHref?: string;
	infoTooltip?: string;
	title: string;
	children?: OnboardingItemConfiguration<T>[];
}
