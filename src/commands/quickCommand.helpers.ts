'use strict';
import { Arrays } from '../system';
import { GitBranch, GitTag, Repository } from '../git/git';
import { BranchQuickPickItem, TagQuickPickItem } from '../quickpicks';

export async function getBranchesAndOrTags(
	repos: Repository | Repository[],
	includeTags: boolean,
	{
		filterBranches,
		filterTags,
		picked
	}: { filterBranches?: (b: GitBranch) => boolean; filterTags?: (t: GitTag) => boolean; picked?: string } = {}
) {
	let branches: GitBranch[];
	let tags: GitTag[] | undefined;

	let singleRepo = false;
	if (repos instanceof Repository || repos.length === 1) {
		singleRepo = true;
		const repo = repos instanceof Repository ? repos : repos[0];

		[branches, tags] = await Promise.all<GitBranch[], GitTag[] | undefined>([
			repo.getBranches({ filter: filterBranches, sort: true }),
			includeTags ? repo.getTags({ filter: filterTags, includeRefs: true, sort: true }) : undefined
		]);
	} else {
		const [branchesByRepo, tagsByRepo] = await Promise.all<GitBranch[][], GitTag[][] | undefined>([
			Promise.all(repos.map(r => r.getBranches({ filter: filterBranches, sort: true }))),
			includeTags
				? Promise.all(repos.map(r => r.getTags({ filter: filterTags, includeRefs: true, sort: true })))
				: undefined
		]);

		branches = GitBranch.sort(
			Arrays.intersection(...branchesByRepo, ((b1: GitBranch, b2: GitBranch) => b1.name === b2.name) as any)
		);

		if (includeTags) {
			tags = GitTag.sort(
				Arrays.intersection(...tagsByRepo!, ((t1: GitTag, t2: GitTag) => t1.name === t2.name) as any)
			);
		}
	}

	if (!includeTags) {
		return Promise.all(
			branches.map(b =>
				BranchQuickPickItem.create(b, undefined, {
					current: singleRepo ? 'checkmark' : false,
					ref: singleRepo,
					status: singleRepo,
					type: 'remote'
				})
			)
		);
	}

	return Promise.all<BranchQuickPickItem | TagQuickPickItem>([
		...branches!
			.filter(b => !b.remote)
			.map(b =>
				BranchQuickPickItem.create(b, picked != null && b.ref === picked, {
					current: singleRepo ? 'checkmark' : false,
					ref: singleRepo,
					status: singleRepo
				})
			),
		...tags!.map(t =>
			TagQuickPickItem.create(t, picked != null && t.ref === picked, {
				ref: singleRepo,
				type: true
			})
		),
		...branches!
			.filter(b => b.remote)
			.map(b =>
				BranchQuickPickItem.create(b, picked != null && b.ref === picked, {
					current: singleRepo ? 'checkmark' : false,
					type: 'remote'
				})
			)
	]);
}
