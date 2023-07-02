declare module 'vscode' {
	export interface GitTimelineItem extends TimelineItem {
		readonly ref: string;
		readonly previousRef: string;
		readonly message: string;
	}
}
