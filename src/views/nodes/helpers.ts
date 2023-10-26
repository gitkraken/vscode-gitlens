import type { GitCommit } from '../../git/models/commit';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues } from './abstract/viewNode';
import { MessageNode } from './common';

const markers: [number, string][] = [
	[0, 'Less than a week ago'],
	[7, 'Over a week ago'],
	[25, 'Over a month ago'],
	[77, 'Over 3 months ago'],
];

export function* insertDateMarkers<T extends ViewNode & { commit: GitCommit }>(
	iterable: Iterable<T>,
	parent: ViewNode,
	skip?: number,
	{ show }: { show: boolean } = { show: true },
): Iterable<ViewNode> {
	if (!parent.view.config.showRelativeDateMarkers || !show) {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return yield* iterable;
	}

	let index = skip ?? 0;
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

			const date = new Date(node.commit.committer.date).setUTCHours(0, 0, 0, 0);
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

				// Don't show the marker if it is the first node
				if (!first) {
					yield new MessageNode(
						parent.view,
						parent,
						'',
						marker,
						undefined,
						undefined,
						ContextValues.DateMarker,
					);
				}

				index++;
				time = undefined;
			}
		}

		first = false;
		yield node;
	}

	return undefined;
}
