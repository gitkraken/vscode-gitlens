import { AccessibilityInformation, Command, ThemeIcon, Uri } from 'vscode';

declare module 'vscode' {
	export interface TimelineItem {
		readonly timestamp: number;
		readonly label: string;

		readonly id?: string;
		readonly iconPath?: Uri | { light: Uri; dark: Uri } | ThemeIcon;
		readonly description?: string;
		readonly detail?: string;
		readonly command?: Command;
		readonly contextValue?: string;
		readonly accessibilityInformation?: AccessibilityInformation;
	}

	export interface GitTimelineItem extends TimelineItem {
		readonly ref: string;
		readonly previousRef: string;
		readonly message: string;
	}
}
