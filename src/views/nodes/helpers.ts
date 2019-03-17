'use strict';
import { Container } from '../../container';
import { GitLogCommit } from '../../git/gitService';
import { Arrays } from '../../system';
import { MessageNode } from './common';
import { ViewNode } from './viewNode';

export async function getBranchesAndTagTipsFn(repoPath: string | undefined, currentName?: string) {
    const [branches, tags] = await Promise.all([
        Container.git.getBranches(repoPath),
        Container.git.getTags(repoPath, { includeRefs: true })
    ]);

    const branchesAndTagsBySha = Arrays.groupByFilterMap(
        (branches as { name: string; sha: string }[]).concat(tags as { name: string; sha: string }[]),
        bt => bt.sha!,
        bt => (bt.name === currentName ? undefined : bt.name)
    );

    return (sha: string) => {
        const branchesAndTags = branchesAndTagsBySha.get(sha);
        if (branchesAndTags === undefined || branchesAndTags.length === 0) return undefined;
        return branchesAndTags.join(', ');
    };
}

const markers: [number, string][] = [
    [0, 'Less than a week ago'],
    [7, 'Over a week ago'],
    [30, 'Over a month ago'],
    [90, 'Over 3 months ago']
];

// eslint-disable-next-line consistent-return
export function* insertDateMarkers<T extends ViewNode & { commit: GitLogCommit }>(
    iterable: Iterable<T>,
    parent: ViewNode,
    skip?: number
): Iterable<ViewNode> {
    if (!parent.view.config.showRelativeDateMarkers) {
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

            const date = new Date(node.commit.committedDate.setUTCHours(0, 0, 0, 0)).getTime();
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
