import type { Remote } from '@eamodio/supertalk';
import type { BranchComparisonOptions, GraphServices, ScopeSelection } from '../../../../plus/graph/graphService.js';
import { createResource } from '../../../shared/state/resource.js';
import type { DetailsResources, ResolvedServices } from './detailsActions.js';
import { DetailsActions } from './detailsActions.js';
import type { DetailsState } from './detailsState.js';

/**
 * Resolves all remote sub-services for the Graph Details panel, wraps them into the
 * `DetailsResources` bag of RPC-backed resources, and constructs the `DetailsActions`
 * orchestrator. The Lit element that mounts the panel should call this and then kick
 * off initial fetches — service resolution itself is not an element concern.
 *
 * Keeping this out of the element keeps the component focused on render routing and
 * lifecycle, and makes the resource wiring reviewable in isolation.
 */
export async function resolveDetailsActions(
	services: Remote<GraphServices>,
	state: DetailsState,
): Promise<DetailsActions> {
	const [
		files,
		graphInspect,
		autolinks,
		branches,
		pullRequests,
		repository,
		config,
		storage,
		subscription,
		integrations,
		commands,
		ai,
		telemetry,
	] = await Promise.all([
		services.files,
		services.graphInspect,
		services.autolinks,
		services.branches,
		services.pullRequests,
		services.repository,
		services.config,
		services.storage,
		services.subscription,
		services.integrations,
		services.commands,
		services.ai,
		services.telemetry,
	]);

	const resolved: ResolvedServices = {
		files: files,
		graphInspect: graphInspect,
		autolinks: autolinks,
		branches: branches,
		pullRequests: pullRequests,
		repository: repository,
		config: config,
		storage: storage,
		subscription: subscription,
		integrations: integrations,
		commands: commands,
		ai: ai,
		telemetry: telemetry,
	};

	const resources: DetailsResources = {
		commit: createResource((signal, repoPath: string, sha: string) =>
			graphInspect.getCommit(repoPath, sha, signal),
		),
		wip: createResource((signal, repoPath: string) => graphInspect.getWip(repoPath, signal)),
		compare: createResource((signal, repoPath: string, fromSha: string, toSha: string) =>
			graphInspect.getCompareDiff(repoPath, fromSha, toSha, signal),
		),
		branchCompareSummary: createResource(
			(signal, repoPath: string, leftRef: string, rightRef: string, options: BranchComparisonOptions) =>
				graphInspect.getBranchComparisonSummary(repoPath, leftRef, rightRef, options, signal),
		),
		branchCompareSide: createResource(
			(
				signal,
				repoPath: string,
				leftRef: string,
				rightRef: string,
				side: 'ahead' | 'behind',
				options: BranchComparisonOptions,
			) => graphInspect.getBranchComparisonSide(repoPath, leftRef, rightRef, side, options, signal),
		),
		review: createResource(
			(
				signal,
				repoPath: string,
				scope: ScopeSelection,
				instructions: string | undefined,
				excludedFiles: string[] | undefined,
			) => graphInspect.reviewChanges(repoPath, scope, instructions, excludedFiles, signal),
		),
		compose: createResource(
			(
				signal,
				repoPath: string,
				scope: ScopeSelection,
				instructions: string | undefined,
				excludedFiles: string[] | undefined,
				aiExcludedFiles: string[] | undefined,
			) => graphInspect.composeChanges(repoPath, scope, instructions, excludedFiles, aiExcludedFiles, signal),
		),
		scopeFiles: createResource((signal, repoPath: string, scope: ScopeSelection) =>
			graphInspect.getScopeFiles(repoPath, scope, signal),
		),
	};

	return new DetailsActions(state, resolved, resources);
}
