'use strict';
import { QuickPick } from 'vscode';
import { Arrays } from '../system';
import { GitBranch, GitTag, Repository } from '../git/git';
import { BranchQuickPickItem, CommitQuickPickItem, TagQuickPickItem } from '../quickpicks';
import { Container } from '../container';

export async function getBranches(
	repos: Repository | Repository[],
	options: { filterBranches?: (b: GitBranch) => boolean; picked?: string | string[] } = {}
): Promise<BranchQuickPickItem[]> {
	return getBranchesAndOrTags(repos, ['branches'], options) as Promise<BranchQuickPickItem[]>;
}

export async function getTags(
	repos: Repository | Repository[],
	options: { filterTags?: (t: GitTag) => boolean; picked?: string | string[] } = {}
): Promise<TagQuickPickItem[]> {
	return getBranchesAndOrTags(repos, ['tags'], options) as Promise<TagQuickPickItem[]>;
}

export async function getBranchesAndOrTags(
	repos: Repository | Repository[],
	include: ('tags' | 'branches')[],
	{
		filterBranches,
		filterTags,
		picked
	}: {
		filterBranches?: (b: GitBranch) => boolean;
		filterTags?: (t: GitTag) => boolean;
		picked?: string | string[];
	} = {}
): Promise<(BranchQuickPickItem | TagQuickPickItem)[]> {
	let branches: GitBranch[] | undefined;
	let tags: GitTag[] | undefined;

	let singleRepo = false;
	if (repos instanceof Repository || repos.length === 1) {
		singleRepo = true;
		const repo = repos instanceof Repository ? repos : repos[0];

		[branches, tags] = await Promise.all<GitBranch[] | undefined, GitTag[] | undefined>([
			include.includes('branches') ? repo.getBranches({ filter: filterBranches, sort: true }) : undefined,
			include.includes('tags') ? repo.getTags({ filter: filterTags, sort: true }) : undefined
		]);
	} else {
		const [branchesByRepo, tagsByRepo] = await Promise.all<GitBranch[][] | undefined, GitTag[][] | undefined>([
			include.includes('branches')
				? Promise.all(repos.map(r => r.getBranches({ filter: filterBranches, sort: true })))
				: undefined,
			include.includes('tags')
				? Promise.all(repos.map(r => r.getTags({ filter: filterTags, sort: true })))
				: undefined
		]);

		if (include.includes('branches')) {
			branches = GitBranch.sort(
				Arrays.intersection(...branchesByRepo!, ((b1: GitBranch, b2: GitBranch) => b1.name === b2.name) as any)
			);
		}

		if (include.includes('tags')) {
			tags = GitTag.sort(
				Arrays.intersection(...tagsByRepo!, ((t1: GitTag, t2: GitTag) => t1.name === t2.name) as any)
			);
		}
	}

	if (include.includes('branches') && !include.includes('tags')) {
		return Promise.all(
			branches!.map(b =>
				BranchQuickPickItem.create(
					b,
					picked != null && (typeof picked === 'string' ? b.ref === picked : picked.includes(b.ref)),
					{
						current: singleRepo ? 'checkmark' : false,
						ref: singleRepo,
						status: singleRepo,
						type: 'remote'
					}
				)
			)
		);
	}

	if (include.includes('tags') && !include.includes('branches')) {
		return Promise.all(
			tags!.map(t =>
				TagQuickPickItem.create(
					t,
					picked != null && (typeof picked === 'string' ? t.ref === picked : picked.includes(t.ref)),
					{
						message: singleRepo,
						ref: singleRepo
					}
				)
			)
		);
	}

	return Promise.all<BranchQuickPickItem | TagQuickPickItem>([
		...branches!
			.filter(b => !b.remote)
			.map(b =>
				BranchQuickPickItem.create(
					b,
					picked != null && (typeof picked === 'string' ? b.ref === picked : picked.includes(b.ref)),
					{
						current: singleRepo ? 'checkmark' : false,
						ref: singleRepo,
						status: singleRepo
					}
				)
			),
		...tags!.map(t =>
			TagQuickPickItem.create(
				t,
				picked != null && (typeof picked === 'string' ? t.ref === picked : picked.includes(t.ref)),
				{
					message: singleRepo,
					ref: singleRepo,
					type: true
				}
			)
		),
		...branches!
			.filter(b => b.remote)
			.map(b =>
				BranchQuickPickItem.create(
					b,
					picked != null && (typeof picked === 'string' ? b.ref === picked : picked.includes(b.ref)),
					{
						current: singleRepo ? 'checkmark' : false,
						ref: singleRepo,
						status: singleRepo,
						type: 'remote'
					}
				)
			)
	]);
}

export function getValidateGitReferenceFn(repo: Repository | Repository[]) {
	return async (quickpick: QuickPick<any>, value: string) => {
		if (Array.isArray(repo)) {
			if (Repository.length !== 1) return false;

			repo = repo[0];
		}

		if (!(await Container.git.validateReference(repo.path, value))) return false;

		const commit = await Container.git.getCommit(repo.path, value);
		quickpick.items = [CommitQuickPickItem.create(commit!, true, { alwaysShow: true, compact: true, icon: true })];
		return true;
	};
}
