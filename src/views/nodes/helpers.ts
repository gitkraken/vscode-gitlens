'use strict';
import { GitLogCommit } from '../../git/git';
import { MessageNode } from './common';
import { ViewNode } from './viewNode';

const markers: [number, string][] = [
	[0, 'Less than a week ago'],
	[7, 'Over a week ago'],
	[30, 'Over a month ago'],
	[90, 'Over 3 months ago'],
];

// eslint-disable-next-line consistent-return
export function* insertDateMarkers<T extends ViewNode & { commit: GitLogCommit }>(
	iterable: Iterable<T>,
	parent: ViewNode,
	skip?: number,
	{ show }: { show: boolean } = { show: true },
): Iterable<ViewNode> {
	if (!parent.view.config.showRelativeDateMarkers || !show) {
		return yield* iterable;
	}

	let index = skip || 0;
	let time = undefined;
	const now = Date.now();

	let first = true;

	for (const node of iterable) {
		if (index < markers.length) {
			let [daysAgo, marker] = markers[index];
			if (time === undefined) {
				const date = new Date(now);
				time = date.setDate(date.getDate() - daysAgo);
			}

			const date = new Date(node.commit.committerDate.setUTCHours(0, 0, 0, 0)).getTime();
			if (date <= time) {
				while (index < markers.length - 1) {
					[daysAgo] = markers[index + 1];
					const nextDate = new Date(now);
					const nextTime = nextDate.setDate(nextDate.getDate() - daysAgo);

					if (date > nextTime) break;

					index++;
					time = undefined;
					[, marker] = markers[index];
				}

				// Don't show the last marker as the first entry -- since it could be wildly far off
				if (!first || index < markers.length - 1) {
					yield new MessageNode(parent.view, parent, marker);
				}

				index++;
				time = undefined;
			}
		}

		first = false;
		yield node;
	}
}
