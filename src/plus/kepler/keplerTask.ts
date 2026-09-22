import { l10n, window } from 'vscode';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { ProviderReference } from '@gitlens/git/models/remoteProvider.js';
import { getRepositoryIdentityForPullRequest } from '@gitlens/git/utils/pullRequest.utils.js';
import type { Source } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { openUrl } from '../../system/-webview/vscode/uris.js';
import type { KeplerTaskLinkOptions } from './keplerLink.js';
import { createKeplerTaskLink } from './keplerLink.js';
import type { KeplerProviderId } from './keplerProviders.js';
import { getKeplerProviderId, isKeplerSupportedProvider } from './keplerProviders.js';

/** Why a Kepler task is being started. Only `action` varies by intent (design doc §10). */
export type KeplerTaskIntent = 'start-review' | 'start-work' | 'new-task';

export type KeplerTaskAction = 'default-review' | 'default-plan';

/** The PR or issue a task starts from — identity only; Kepler resolves everything else (design doc §10). */
export interface KeplerTaskItem {
	kind: 'pr' | 'issue';
	url: string;
	provider: Pick<ProviderReference, 'id' | 'name'>;
}

export interface KeplerTaskRequest {
	intent: KeplerTaskIntent;
	item?: KeplerTaskItem;
	/** Absolute local path of a clone that resolved silently; omitted from the link when absent (design doc §7). */
	repoPath?: string;
}

export type KeplerTaskResolution =
	| {
			readonly supported: true;
			readonly options: KeplerTaskLinkOptions;
			readonly provider: KeplerProviderId | undefined;
			readonly action: KeplerTaskAction | undefined;
	  }
	| {
			readonly supported: false;
			readonly item: KeplerTaskItem;
			readonly provider: KeplerProviderId | undefined;
	  };

export function getKeplerTaskAction(intent: KeplerTaskIntent): KeplerTaskAction | undefined {
	switch (intent) {
		case 'start-review':
			return 'default-review';
		case 'start-work':
			return 'default-plan';
		default:
			return undefined;
	}
}

/**
 * Turns a request into link options, or refuses it when the item's provider is one Kepler cannot
 * serve for that kind. An item whose provider does not map to a Kepler id at all is refused too:
 * sending it without `provider` would not classify on Kepler's side, so the Composer would open
 * with nothing useful staged — a notification from us is the more honest outcome.
 */
export function resolveKeplerTaskRequest(request: KeplerTaskRequest): KeplerTaskResolution {
	const { item } = request;
	const provider = item != null ? getKeplerProviderId(item.provider.id) : undefined;
	if (item != null && !isKeplerSupportedProvider(item.kind, provider)) {
		return { supported: false, item: item, provider: provider };
	}

	const action = getKeplerTaskAction(request.intent);
	return {
		supported: true,
		options: {
			url: item?.url,
			kind: item?.kind,
			provider: provider,
			repo: request.repoPath,
			action: action,
		},
		provider: provider,
		action: action,
	};
}

/**
 * Deep links into an installed Kepler's Task Composer. Shared by every entry point (tree/Graph
 * commands, and the Start Work/Review wizard route), so the gate, link and telemetry stay in one
 * place. Returns whether the link was handed off — never whether Kepler actually handled it
 * (design doc §9.1).
 */
export async function startKeplerTask(
	container: Container,
	request: KeplerTaskRequest,
	source?: Source,
): Promise<boolean> {
	const resolution = resolveKeplerTaskRequest(request);

	// Enums and booleans only — never the URL, the repo path, `owner/name`, or a title (design doc §9.4)
	const data = {
		intent: request.intent,
		kind: request.item?.kind,
		provider: resolution.provider,
		'provider.mapped': request.item != null ? resolution.provider != null : undefined,
		'repo.resolved': request.repoPath != null,
		channel: container.kepler.channel,
		action: resolution.supported ? resolution.action : undefined,
	};

	if (!resolution.supported) {
		container.telemetry.sendEvent(
			'kepler/task/start/failed',
			{ ...data, 'failure.reason': 'unsupported-provider' },
			source,
		);

		const providerName = resolution.item.provider.name;
		void window.showWarningMessage(
			resolution.item.kind === 'pr'
				? l10n.t("Kepler doesn't support pull requests from {0}", providerName)
				: l10n.t("Kepler doesn't support issues from {0}", providerName),
		);
		return false;
	}

	let opened: boolean;
	try {
		opened = await openUrl(createKeplerTaskLink(container.kepler.scheme, resolution.options));
	} catch {
		opened = false;
	}

	if (!opened) {
		container.telemetry.sendEvent('kepler/task/start/failed', { ...data, 'failure.reason': 'open-failed' }, source);
		return false;
	}

	container.telemetry.sendEvent('kepler/task/start', data, source);
	return true;
}

/**
 * Validates a repo path for the `repo=` param: it must be a repository GitLens already knows and
 * not a virtual one (a virtual repo's path is not on disk). Returns the OS-native absolute path.
 *
 * A worktree resolves to its MAIN clone. Kepler maps a path to a catalog repo id, not a location
 * (`resolveRepoIdFromPathOffline` in the Kepler repo): the main clone matches its repo catalog
 * directly, whereas a worktree path only matches if Kepler tracks that worktree itself or it sits
 * under the `.worktrees` convention — so a GitLens-created worktree elsewhere would miss.
 */
export function getKeplerRepoPath(container: Container, repoPath: string | undefined): string | undefined {
	if (!repoPath) return undefined;

	const repo = container.git.getRepository(repoPath);
	if (repo == null || repo.virtual) return undefined;

	return (repo.commonUri ?? repo.uri).fsPath;
}

/**
 * Finds a local clone for a PR by lookup only — unlike `getOrOpenPullRequestRepository`, which
 * registers a closed repository for a known-but-unopened clone (`openIfNeeded`) and, for GitHub,
 * adds a virtual repository whose path is not on disk. Never prompts (design doc §7).
 */
export async function findKeplerRepoPathForPullRequest(
	container: Container,
	pr: PullRequest,
): Promise<string | undefined> {
	for (const identity of [getRepositoryIdentityForPullRequest(pr), getRepositoryIdentityForPullRequest(pr, false)]) {
		const repo = await container.repositoryIdentity.getRepository(identity, {
			openIfNeeded: false,
			prompt: false,
		});
		if (repo != null && !repo.virtual) return repo.path;
	}

	return undefined;
}
