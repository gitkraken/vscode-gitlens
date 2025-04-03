import type { ProgressOptions } from 'vscode';
import { ProgressLocation, Uri, window } from 'vscode';
import { Schemes } from '../../../constants';
import type { Source } from '../../../constants.telemetry';
import type { Container } from '../../../container';
import type { LeftRightCommitCountResult } from '../../gitProvider';
import type { PullRequest, PullRequestComparisonRefs } from '../../models/pullRequest';
import type { CreatePullRequestRemoteResource } from '../../models/remoteResource';
import type { Repository } from '../../models/repository';
import { getComparisonRefsForPullRequest, getRepositoryIdentityForPullRequest } from '../pullRequest.utils';
import { createRevisionRange } from '../revision.utils';

export async function describePullRequestWithAI(
	container: Container,
	repo: string | Repository,
	{ base, head }: CreatePullRequestRemoteResource,
	source: Source,
	options?: { progress?: ProgressOptions },
): Promise<{ title: string; description: string } | undefined> {
	if (!base?.remote || !head?.remote || !base?.branch || !head?.branch) {
		return undefined;
	}

	if (typeof repo === 'string') {
		const r = container.git.getRepository(repo);
		if (r == null) return undefined;

		repo = r;
	}

	try {
		const result = await container.ai.generateCreatePullRequest(
			repo,
			`${base.remote.name}/${base.branch}`,
			`${head.remote.name}/${head.branch}`,
			source,
			{
				progress: { location: ProgressLocation.Notification },
				...options,
			},
		);
		return result?.parsed ? { title: result.parsed.summary, description: result.parsed.body } : undefined;
	} catch (ex) {
		void window.showErrorMessage(ex.message);
		return undefined;
	}
}

export async function ensurePullRequestRefs(
	pr: PullRequest,
	repo: Repository,
	options?: { silent?: true; promptMessage?: never } | { silent?: never; promptMessage?: string },
	refs?: PullRequestComparisonRefs,
): Promise<LeftRightCommitCountResult | undefined> {
	if (pr.refs == null) return undefined;

	refs ??= getComparisonRefsForPullRequest(repo.path, pr.refs);
	const range = createRevisionRange(refs.base.ref, refs.head.ref, '...');

	const commitsProvider = repo.git.commits();
	let counts = await commitsProvider.getLeftRightCommitCount(range);
	if (counts == null) {
		if (await ensurePullRequestRemote(pr, repo, options)) {
			counts = await commitsProvider.getLeftRightCommitCount(range);
		}
	}

	return counts;
}

export async function ensurePullRequestRemote(
	pr: PullRequest,
	repo: Repository,
	options?: { silent?: true; promptMessage?: never } | { silent?: never; promptMessage?: string },
): Promise<boolean> {
	const identity = getRepositoryIdentityForPullRequest(pr);
	if (identity.remote.url == null) return false;

	const prRemoteUrl = identity.remote.url.replace(/\.git$/, '');

	let found = false;
	for (const remote of await repo.git.remotes().getRemotes()) {
		if (remote.matches(prRemoteUrl)) {
			found = true;
			break;
		}
	}

	if (found) return true;

	const confirm = { title: 'Add Remote' };
	const cancel = { title: 'Cancel', isCloseAffordance: true };
	if (!options?.silent) {
		const result = await window.showInformationMessage(
			`${
				options?.promptMessage ?? `Unable to find a remote for PR #${pr.id}.`
			}\nWould you like to add a remote for '${identity.provider.repoDomain}?`,
			{ modal: true },
			confirm,
			cancel,
		);

		if (result === confirm) {
			await repo.git
				.remotes()
				.addRemoteWithResult?.(identity.provider.repoDomain, identity.remote.url, { fetch: true });
			return true;
		}
	}

	return false;
}

export async function getOpenedPullRequestRepo(
	container: Container,
	pr: PullRequest,
	repoPath?: string,
): Promise<Repository | undefined> {
	if (repoPath) return container.git.getRepository(repoPath);

	const repo = await getOrOpenPullRequestRepository(container, pr, { promptIfNeeded: true });
	return repo;
}

export async function getOrOpenPullRequestRepository(
	container: Container,
	pr: PullRequest,
	options?: { promptIfNeeded?: boolean; skipVirtual?: boolean },
): Promise<Repository | undefined> {
	const identity = getRepositoryIdentityForPullRequest(pr);
	let repo = await container.repositoryIdentity.getRepository(identity, {
		openIfNeeded: true,
		keepOpen: false,
		prompt: false,
	});

	if (repo == null && !options?.skipVirtual) {
		const virtualUri = getVirtualUriForPullRequest(pr);
		if (virtualUri != null) {
			repo = await container.git.getOrOpenRepository(virtualUri, { closeOnOpen: true, detectNested: false });
		}
	}

	if (repo == null) {
		const baseIdentity = getRepositoryIdentityForPullRequest(pr, false);
		repo = await container.repositoryIdentity.getRepository(baseIdentity, {
			openIfNeeded: true,
			keepOpen: false,
			prompt: false,
		});
	}

	if (repo == null && options?.promptIfNeeded) {
		repo = await container.repositoryIdentity.getRepository(identity, {
			openIfNeeded: true,
			keepOpen: false,
			prompt: true,
		});
	}

	return repo;
}

export function getVirtualUriForPullRequest(pr: PullRequest): Uri | undefined {
	if (pr.provider.id !== 'github') return undefined;

	const uri = Uri.parse(pr.refs?.base?.url ?? pr.url);
	return uri.with({ scheme: Schemes.Virtual, authority: 'github', path: uri.path });
}
