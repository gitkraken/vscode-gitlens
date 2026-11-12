import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import type { ScopeSelection } from './graphService.js';

/** The two sides a review scope's files open with — what the reader reads, so what finding lines point into. */
export function getReviewDiffEndpoints(scope: ScopeSelection | undefined): { lhs: string; rhs: string } | undefined {
	if (scope == null) return undefined;
	if (scope.type === 'commit') return { lhs: `${scope.sha}^`, rhs: scope.sha };
	if (scope.type === 'compare') return { lhs: scope.fromSha, rhs: scope.toSha };

	// wip — match scope inputs as closely as possible with a single range
	const hasShas = (scope.includeShas?.length ?? 0) > 0;
	if (!hasShas) {
		if (scope.includeUnstaged && !scope.includeStaged) {
			return { lhs: uncommittedStaged, rhs: uncommitted };
		}
		if (!scope.includeUnstaged && scope.includeStaged) {
			return { lhs: 'HEAD', rhs: uncommittedStaged };
		}
		return { lhs: 'HEAD', rhs: uncommitted };
	}

	// Seeded scopes guarantee the range-base boundary commit last and the tip first (see
	// GraphComposeScopeSeed); picker-driven scopes are in pane row order (newest-first), where the
	// bottom row is the visible range base. Commits-only ranges diff to the selection's own tip —
	// an interior range ends below HEAD, so 'HEAD' would fold newer commits into the diff.
	const lhs = `${scope.includeShas.at(-1)}^`;
	if (scope.includeUnstaged) return { lhs: lhs, rhs: uncommitted };
	if (scope.includeStaged) return { lhs: lhs, rhs: uncommittedStaged };
	return { lhs: lhs, rhs: scope.includeShas[0] };
}
