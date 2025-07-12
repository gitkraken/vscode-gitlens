import type { GitTimelineItem, TimelineItem } from 'vscode';

function isTimelineItem(item: any): item is TimelineItem {
	if (item == null) return false;

	return (item as TimelineItem).timestamp != null && (item as TimelineItem).label != null;
}

export function isGitTimelineItem(item: any): item is GitTimelineItem {
	if (item == null) return false;

	return (
		isTimelineItem(item) &&
		(item as GitTimelineItem).ref != null &&
		(item as GitTimelineItem).previousRef != null &&
		(item as GitTimelineItem).message != null
	);
}
