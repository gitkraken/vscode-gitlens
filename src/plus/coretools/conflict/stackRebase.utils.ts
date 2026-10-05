import { l10n } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { PullRequestStackLayer } from '@gitlens/git/models/pullRequest.js';
import { formatPlural } from '@gitlens/utils/plural.js';
import type { Container } from '../../../container.js';
import type { GitRepositoryService } from '../../../git/gitRepositoryService.js';
import { getBranchAssociatedPullRequest } from '../../../git/utils/-webview/branch.utils.js';
import { getBestRemoteWithIntegration, getRemoteIntegration } from '../../../git/utils/-webview/remote.utils.js';
import type { StackRebasePlan, StackRebasePlanResult, StackRebaseStep } from './stackRebase.types.js';

/**
 * Resolves the bottom-to-top cascade for the stack a pull request belongs to, or a typed refusal
 * explaining why there's nothing to run. Read-only — it touches the host and the local branch list
 * and never mutates the repository, so callers can plan speculatively (e.g. to decide whether to
 * even offer the action) and confirm later.
 *
 * Merged layers are dropped: their commits are already on the trunk, so replaying them would either
 * no-op or resurrect them. Layers with no local branch are kept, marked to be created from their
 * remote-tracking ref — a stack is frequently only partly checked out locally, and skipping a middle
 * layer would break the chain for every layer above it.
 */
export async function resolveStackRebasePlan(
	container: Container,
	svc: GitRepositoryService,
	options?: { pullRequestNumber?: number; cancellation?: AbortSignal },
): Promise<StackRebasePlanResult> {
	if (svc.ops == null) {
		return {
			ok: false,
			reason: 'unavailable',
			message: l10n.t('Rebasing stacked pull requests is not available in this environment.'),
		};
	}

	const remote = await getBestRemoteWithIntegration(svc.path, undefined, options?.cancellation);
	const integration = remote != null ? await getRemoteIntegration(remote) : undefined;
	const owner = remote?.provider.owner;
	const repoName = remote?.provider.repoName;
	if (remote == null || integration == null || owner == null || repoName == null) {
		return {
			ok: false,
			reason: 'no-integration',
			message: l10n.t('Connect a supported integration to rebase stacked pull requests.'),
		};
	}

	let pullRequestNumber = options?.pullRequestNumber;
	if (pullRequestNumber == null) {
		const branch = await svc.branches.getBranch(undefined, undefined, options?.cancellation);
		const pr = branch != null ? await getBranchAssociatedPullRequest(container, branch) : undefined;
		// `id` is the pull request number as a string on every host with a stacks concept, but prefer
		// the explicit `number` when the provider set it
		const number = pr?.number ?? (pr != null ? Number.parseInt(pr.id, 10) : Number.NaN);
		if (!Number.isFinite(number)) {
			return {
				ok: false,
				reason: 'not-stacked',
				message: l10n.t('The current branch has no pull request, so there is no stack to rebase.'),
			};
		}

		pullRequestNumber = number;
	}

	const layers = await integration.getStackLayersForPullRequest?.(
		owner,
		repoName,
		pullRequestNumber,
		options?.cancellation,
	);
	if (layers == null) {
		return {
			ok: false,
			reason: 'no-stack',
			message: l10n.t('Pull request #{0} is not part of a stack.', pullRequestNumber),
		};
	}

	const unmerged = layers.layers.filter(l => !l.merged);
	if (!unmerged.length) {
		return {
			ok: false,
			reason: 'no-unmerged-layers',
			message: l10n.t('Every pull request in this stack has already been merged.'),
		};
	}

	const branches = (await svc.branches.getBranches(undefined, options?.cancellation)).values;
	const steps: StackRebaseStep[] = [];
	const uncreatable: string[] = [];
	for (const layer of unmerged) {
		const local = findLocalBranchForLayer(branches, layer, remote.name);
		if (local != null) {
			steps.push({ prNumber: layer.number, headRef: layer.headRef, branchName: local.name, status: 'pending' });
			continue;
		}

		// No local branch yet — the cascade creates one from the remote-tracking ref so the chain stays
		// unbroken. A provider without `createBranch` can't, and a gap would silently rebase the layers
		// above onto stale bases, so refuse the whole run rather than run a broken one.
		if (svc.branches.createBranch == null) {
			uncreatable.push(layer.headRef);
		}
		steps.push({
			prNumber: layer.number,
			headRef: layer.headRef,
			branchName: layer.headRef,
			createFromRef: `${remote.name}/${layer.headRef}`,
			status: 'pending',
		});
	}

	if (uncreatable.length) {
		return {
			ok: false,
			reason: 'cannot-create-branch',
			message: formatPlural(
				l10n.t(
					'{count, plural, one{{branches} has no local branch and one can’t be created here} other{{branches} have no local branches and they can’t be created here}}',
				),
				{ count: uncreatable.length, branches: uncreatable.join(', ') },
			),
		};
	}

	return {
		ok: true,
		plan: {
			stackNumber: layers.number,
			baseRef: layers.baseRef,
			upstreamRef: `${remote.name}/${layers.baseRef}`,
			remoteName: remote.name,
			steps: steps,
		},
	};
}

/**
 * The local branch that stands in for a stack layer: the one tracking its head ref on this remote,
 * then any branch tracking that head ref, and finally a same-named branch (a local branch the user
 * never pushed, or one whose upstream was dropped).
 */
function findLocalBranchForLayer(
	branches: GitBranch[],
	layer: PullRequestStackLayer,
	remoteName: string,
): GitBranch | undefined {
	let tracking: GitBranch | undefined;
	let named: GitBranch | undefined;

	for (const b of branches) {
		if (b.remote) continue;

		if (b.trackingWithoutRemote === layer.headRef) {
			if (b.remoteName === remoteName) return b;

			tracking ??= b;
		} else if (b.name === layer.headRef) {
			named ??= b;
		}
	}

	return tracking ?? named;
}

/**
 * The confirmation/summary copy for a plan — the chain as a bottom-to-top arrow list plus what the
 * run will touch. Shared by the confirmation quick pick and the progress surfaces so the counts a
 * user agrees to are the ones they're later told about.
 */
export function describeStackRebasePlan(plan: StackRebasePlan): string {
	// The chain leads: this string is the confirmation's placeholder, which clips around 93 characters,
	// and the chain is the part a user can't get anywhere else — a prose lead-in would push it past the
	// clip and, with real branch names, leave it entirely invisible.
	const created = plan.steps.reduce((n, s) => (s.createFromRef != null ? n + 1 : n), 0);
	const chain = plan.steps.map(s => s.branchName).join(' → ');

	if (created) {
		return formatPlural(
			l10n.t(
				'{count, plural, one{{chain} — {count} branch onto {upstream}, {created} created locally first} other{{chain} — {count} branches onto {upstream}, {created} created locally first}}',
			),
			{ count: plan.steps.length, upstream: plan.upstreamRef, chain: chain, created: created },
		);
	}

	return formatPlural(
		l10n.t(
			'{count, plural, one{{chain} — {count} branch onto {upstream}} other{{chain} — {count} branches onto {upstream}}}',
		),
		{ count: plan.steps.length, upstream: plan.upstreamRef, chain: chain },
	);
}

/** `Branch {current} of {total} · {branch}` — the stack position every user-facing message carries,
 *  so a user never has to work out which branch a rebase, conflict, or escalation belongs to. */
export function formatStackPosition(plan: StackRebasePlan, index: number): string {
	return l10n.t('Branch {current} of {total} · {branch}', {
		current: index + 1,
		total: plan.steps.length,
		branch: plan.steps[index]?.branchName ?? '',
	});
}
