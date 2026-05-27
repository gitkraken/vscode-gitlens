import { Uri } from 'vscode';
import type { GitCommit } from '@gitlens/git/models/commit.js';
import { getChangedFilesCount } from '@gitlens/git/utils/commit.utils.js';
import { createRevisionRange } from '@gitlens/git/utils/revision.utils.js';
import { map } from '@gitlens/utils/iterable.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { areUrisEqual } from '@gitlens/utils/uri.js';
import { getAvatarUri, getCachedAvatarUri } from '../../../avatars.js';
import type { Container } from '../../../container.js';
import type { FeatureAccess, RepoFeatureAccess } from '../../../features.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { getCommitDate } from '../../../git/utils/-webview/commit.utils.js';
import { getReference } from '../../../git/utils/-webview/reference.utils.js';
import { toRepositoryShape } from '../../../git/utils/-webview/repository.utils.js';
import { getPseudoCommitsWithStats } from '../../../git/utils/-webview/statusFile.utils.js';
import type {
	TimelineConfig,
	TimelineDatasetResult,
	TimelineDatum,
	TimelineScope,
	TimelineScopeSerialized,
	TimelineScopeType,
} from './protocol.js';
import { deserializeTimelineScope, serializeTimelineScope } from './utils/-webview/timeline.utils.js';
import { getPeriodDate } from './utils/period.js';

/**
 * Build a timeline dataset for the given scope + config. Pure data fetcher — no view-specific
 * side-effects (telemetry, repo watching, view title). Callers can layer those on top.
 *
 * Used by the Visual History webview's `getDataset` RPC and the Commit Graph webview's
 * `graphTimeline.getDataset` RPC so the same data flows to both surfaces.
 */
export async function buildTimelineDataset(
	container: Container,
	scopeSerialized: TimelineScopeSerialized,
	config: TimelineConfig,
	signal?: AbortSignal,
): Promise<TimelineDatasetResult & { repo: GlRepository | undefined; scopeRef: TimelineScope | undefined }> {
	const scope = deserializeTimelineScope(scopeSerialized);

	const { git } = container;
	if (git.isDiscoveringRepositories) {
		await git.isDiscoveringRepositories;
	}
	signal?.throwIfAborted();

	const repo = git.getRepository(scope.uri) ?? (await git.getOrOpenRepository(scope.uri, { closeOnOpen: true }));
	if (repo == null) {
		const access = await container.subscription.getSubscription();
		return {
			dataset: [],
			scope: scopeSerialized,
			repository: undefined,
			access: { allowed: false, subscription: { current: access } },
			repo: undefined,
			scopeRef: undefined,
		};
	}

	// Reconstruct the correct scope URI from the repo URI + relativePath. The webview may have
	// changed relativePath (via choosePath/changeScope) without updating the serialized URI, so
	// we must rebuild it here.
	if (scopeSerialized.relativePath && scope.type !== 'repo') {
		scope.uri = Uri.joinPath(repo.uri, scopeSerialized.relativePath);
	}

	if (areUrisEqual(scope.uri, repo.uri)) {
		scope.type = 'repo';
	}
	scope.head ??= getReference(await repo.git.branches.getBranch());
	scope.base ??= scope.head;
	const relativePath = git.getRelativePath(scope.uri, repo.uri);
	const enrichedScope = serializeTimelineScope(scope as Required<TimelineScope>, relativePath);
	signal?.throwIfAborted();

	const access = await git.access('timeline', repo.uri);
	signal?.throwIfAborted();
	const dataset = await computeTimelineDataset(container, scope, repo, config, access);

	return {
		dataset: dataset,
		scope: enrichedScope,
		repository: { ...toRepositoryShape(repo), ref: scope.head },
		access: access,
		repo: repo,
		scopeRef: scope,
	};
}

export async function computeTimelineDataset(
	container: Container,
	scope: TimelineScope,
	repo: GlRepository,
	config: TimelineConfig,
	access: RepoFeatureAccess | FeatureAccess,
): Promise<TimelineDatum[]> {
	if (access.allowed === false) {
		return generateRandomTimelineDataset(scope.type);
	}

	// Build the list of refs to walk:
	//   - When `showAllBranches` is true, a single `getContributors(undefined, { all: true })`
	//     covers everything via `git log --all`.
	//   - Otherwise, walk the primary scope ref (head [+ base range]) PLUS any explicit
	//     `additionalBranches` provided by the caller (e.g., the Graph's `includeOnlyRefs` for
	//     smart/favorited modes). Per-ref calls are run in parallel and merged with sha dedup so a
	//     commit reachable from multiple refs counts once.
	const refs: (string | undefined)[] = [];
	if (config.showAllBranches) {
		refs.push(undefined);
	} else {
		let primaryRef = scope.head?.ref;
		if (primaryRef) {
			if (scope.base?.ref != null && scope.base?.ref !== primaryRef) {
				primaryRef = createRevisionRange(primaryRef, scope.base?.ref, '..');
			}
		} else {
			primaryRef = scope.base?.ref;
		}
		refs.push(primaryRef);
		if (config.additionalBranches?.length) {
			const seen = new Set<string>(primaryRef ? [primaryRef] : []);
			for (const b of config.additionalBranches) {
				if (b && !seen.has(b)) {
					seen.add(b);
					refs.push(b);
				}
			}
		}
	}

	// `loadedSpanMs` (standalone Visual History, progressive loading) wins over `period`-derived
	// since: the chart's `gl-load-more` extends the loaded span as the user pans into older history.
	let since: string | undefined;
	if (config.loadedSpanMs != null) {
		since = new Date(Date.now() - config.loadedSpanMs).toISOString();
	} else {
		since = getPeriodDate(config.period)?.toISOString();
	}

	const contributorsOptions = {
		all: config.showAllBranches,
		pathspec: scope.type === 'repo' ? undefined : scope.uri.fsPath,
		since: since,
		stats: true,
	} as const;

	// Split heterogeneous fetches into two `Promise.allSettled` calls so TypeScript can keep the
	// per-result types intact (uniform contributors array, then a sibling array of mixed sub-fetches).
	const [contributorsSettled, [statusFilesResult, currentUserResult]] = await Promise.all([
		Promise.allSettled(refs.map(r => repo.git.contributors.getContributors(r, contributorsOptions))),
		Promise.allSettled([
			repo.virtual
				? Promise.resolve(undefined)
				: scope.type !== 'repo'
					? Promise.resolve(repo.git.status.getStatusForPath?.(scope.uri, { renames: scope.type === 'file' }))
					: repo.git.status.getStatus().then(s => s?.files),
			repo.git.config.getCurrentUser(),
		]),
	]);

	const currentUser = getSettledValue(currentUserResult);

	const dataset: TimelineDatum[] = [];
	const seenShas = new Set<string>();

	for (const result of contributorsSettled) {
		const contributors = getSettledValue(result)?.contributors;
		if (contributors == null) continue;

		for (const contributor of contributors) {
			if (contributor.contributions == null) continue;

			// Pre-resolve the avatar URI per author once — gravatar lookup is an md5 hash of the
			// email; binding it once per contributor avoids re-hashing per commit.
			const email = contributor.email;
			const avatarUri = email != null ? (getCachedAvatarUri(email) ?? getAvatarUri(email)) : undefined;
			const avatarUrl = avatarUri instanceof Uri ? avatarUri.toString() : undefined;

			for (const contribution of contributor.contributions) {
				// Dedup: a commit reachable from multiple refs would otherwise appear N times. Per-
				// commit stats are stable across `getContributors` invocations (the underlying git
				// object is the same), so first-seen wins.
				if (seenShas.has(contribution.sha)) continue;

				seenShas.add(contribution.sha);

				dataset.push({
					author: contributor.name,
					current: contributor.current || undefined,
					email: email,
					avatarUrl: avatarUrl,
					sha: contribution.sha,
					date: contribution.date.toISOString(),
					message: contribution.message,

					files: contribution.files,
					additions: contribution.additions,
					deletions: contribution.deletions,

					sort: contribution.date.getTime(),
				});
			}
		}
	}

	if (config.showAllBranches && config.sliceBy === 'branch' && scope.type !== 'repo' && !repo.virtual) {
		const shas = new Set<string>(
			await repo.git.commits.getLogShas?.(`^${scope.head?.ref ?? 'HEAD'}`, {
				all: true,
				pathOrUri: scope.uri,
				limit: 0,
			}),
		);

		const commitsUnreachableFromHEAD = dataset.filter(d => shas.has(d.sha));
		if (commitsUnreachableFromHEAD.length) {
			// Bound the DAG walk by the oldest target's parents (`^<oldest>^@`). The dataset's
			// `sort` field is already millisecond timestamps from the contributors fetch, so
			// `min(sort)` picks the oldest without an extra git call.
			let oldest = commitsUnreachableFromHEAD[0];
			for (const d of commitsUnreachableFromHEAD) {
				if (d.sort < oldest.sort) {
					oldest = d;
				}
			}

			const branchesBySha = await repo.git.refs.getRefsContainingShas(
				commitsUnreachableFromHEAD.map(d => d.sha),
				oldest.sha,
				{ include: ['heads', 'remotes'] },
			);
			for (const datum of commitsUnreachableFromHEAD) {
				const refs = branchesBySha.get(datum.sha);
				if (refs?.length) {
					datum.branches = refs.map(r => r.name);
				}
			}
		}
	}

	const statusFiles = getSettledValue(statusFilesResult);
	const relativePath = container.git.getRelativePath(scope.uri, repo.uri);

	const pseudoCommits = await getPseudoCommitsWithStats(container, statusFiles, relativePath, currentUser);
	if (pseudoCommits?.length) {
		dataset.splice(0, 0, ...map(pseudoCommits, c => createDatum(c, scope.type)));
	} else if (dataset.length) {
		// Attribute the no-changes Working Tree placeholder to the current Git user — these are
		// the user's *potential* working changes, even when there aren't any.
		dataset.splice(0, 0, {
			author: currentUser?.name ?? dataset[0].author,
			current: currentUser != null || undefined,
			email: currentUser?.email,
			files: 0,
			additions: 0,
			deletions: 0,
			sha: '', // Special case for working tree when there are no working changes
			date: new Date().toISOString(),
			message: 'Working Tree',
			sort: Date.now(),
		} satisfies TimelineDatum);
	}

	dataset.sort((a, b) => b.sort - a.sort);

	return dataset;
}

/** WIP-only counterpart to `computeTimelineDataset` — drives the focused `refreshWip` patch
 *  on working-tree changes so we don't re-walk contributors and per-commit branches just to
 *  update the leading pseudo-commit row. */
export async function buildWipDatums(
	container: Container,
	scopeSerialized: TimelineScopeSerialized,
	signal?: AbortSignal,
): Promise<TimelineDatum[]> {
	const scope = deserializeTimelineScope(scopeSerialized);

	const { git } = container;
	if (git.isDiscoveringRepositories) {
		await git.isDiscoveringRepositories;
	}
	signal?.throwIfAborted();

	const repo = git.getRepository(scope.uri);
	if (repo == null || repo.virtual) return [];

	if (scopeSerialized.relativePath && scope.type !== 'repo') {
		scope.uri = Uri.joinPath(repo.uri, scopeSerialized.relativePath);
	}
	if (areUrisEqual(scope.uri, repo.uri)) {
		scope.type = 'repo';
	}

	const [statusFilesResult, currentUserResult] = await Promise.allSettled([
		scope.type !== 'repo'
			? Promise.resolve(repo.git.status.getStatusForPath?.(scope.uri, { renames: scope.type === 'file' }))
			: repo.git.status.getStatus().then(s => s?.files),
		repo.git.config.getCurrentUser(),
	]);
	signal?.throwIfAborted();

	const statusFiles = getSettledValue(statusFilesResult);
	const currentUser = getSettledValue(currentUserResult);
	const relativePath = git.getRelativePath(scope.uri, repo.uri);

	const pseudoCommits = await getPseudoCommitsWithStats(container, statusFiles, relativePath, currentUser);
	if (pseudoCommits?.length) {
		return [...map(pseudoCommits, c => createDatum(c, scope.type))];
	}

	// No working-tree changes — emit the empty "Working Tree" placeholder so the chart still
	// shows a current-user-attributed pseudo-commit at the top. Matches the placeholder branch
	// in `computeTimelineDataset`. Caller drops this when the dataset has no other rows.
	return [
		{
			author: currentUser?.name ?? 'You',
			current: currentUser != null || undefined,
			email: currentUser?.email,
			files: 0,
			additions: 0,
			deletions: 0,
			sha: '',
			date: new Date().toISOString(),
			message: 'Working Tree',
			sort: Date.now(),
		} satisfies TimelineDatum,
	];
}

function createDatum(commit: GitCommit, scopeType: TimelineScopeType): TimelineDatum {
	let additions: number | undefined;
	let deletions: number | undefined;
	let files: number | undefined;

	const stats = getCommitStats(commit, scopeType);
	if (stats != null) {
		({ additions, deletions } = stats);
	}
	if (scopeType === 'file') {
		files = undefined;
	} else if (commit.stats != null) {
		files = getChangedFilesCount(commit.stats.files);
	}

	const email = commit.author.email;
	// Prefer the cached avatar URI so we don't pay a remote-provider lookup per commit; the cached
	// path returns synchronously and the webview falls back to initials if avatarUrl is missing.
	const avatarUri = email != null ? (getCachedAvatarUri(email) ?? getAvatarUri(email)) : undefined;
	const commitDate = getCommitDate(commit);

	return {
		author: commit.author.name,
		current: commit.author.current || undefined,
		email: email,
		avatarUrl: avatarUri instanceof Uri ? avatarUri.toString() : undefined,
		files: files,
		additions: additions,
		deletions: deletions,
		sha: commit.sha,
		date: commitDate.toISOString(),
		message: commit.message ?? commit.summary,
		sort: commitDate.getTime(),
	};
}

function getCommitStats(
	commit: GitCommit,
	scopeType: TimelineScopeType,
): { additions: number; deletions: number } | undefined {
	if (scopeType === 'file') {
		return commit.file?.stats ?? (getChangedFilesCount(commit.stats?.files) === 1 ? commit.stats : undefined);
	}
	return commit.stats;
}

export function generateRandomTimelineDataset(itemType: TimelineScopeType): TimelineDatum[] {
	const dataset: TimelineDatum[] = [];
	const authors = ['Eric Amodio', 'Justin Roberts', 'Keith Daulton', 'Ramin Tadayon', 'Ada Lovelace', 'Grace Hopper'];

	const count = 10;
	for (let i = 0; i < count; i++) {
		// Generate a random date between now and 3 months ago
		const date = new Date(Date.now() - Math.floor(Math.random() * (3 * 30 * 24 * 60 * 60 * 1000)));
		const author = authors[Math.floor(Math.random() * authors.length)];

		// Generate random additions/deletions between 1 and 20, but ensure we have a tiny and large commit
		const additions = i === 0 ? 2 : i === count - 1 ? 50 : Math.floor(Math.random() * 20) + 1;
		const deletions = i === 0 ? 1 : i === count - 1 ? 25 : Math.floor(Math.random() * 20) + 1;

		dataset.push({
			sha: Math.random().toString(16).substring(2, 10),
			author: author,
			date: date.toISOString(),
			message: `Commit message for changes by ${author}`,

			files: itemType === 'file' ? undefined : Math.floor(Math.random() * (additions + deletions)) + 1,
			additions: additions,
			deletions: deletions,

			sort: date.getTime(),
		});
	}

	return dataset.sort((a, b) => b.sort - a.sort);
}
