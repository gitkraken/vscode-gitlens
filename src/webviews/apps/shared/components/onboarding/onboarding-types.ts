export type OnboardingStateTemplate = Partial<Record<`${string}Checked`, boolean>>;

export interface OnboardingItemConfiguration<T extends string> {
	itemId: T;
	playHref?: string;
	playTooltip?: string;
	infoHref?: string;
	infoTooltip?: string;
	title: string;
	disabled?: boolean;
	children?: OnboardingItemConfiguration<T>[];
}
