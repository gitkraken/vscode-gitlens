import type { GraphShowAction } from '../../../plus/graph/protocol.js';

/** Task-specific access messaging (#5534): when a specific task brought the user to an access wall,
 *  the heading + body confirm that gaining access completes THAT task. Bodies are CTA-free so the
 *  signed-out sign-in screen and the signed-in plan gate can share one string — each screen's own
 *  buttons carry the verb. */
export const intentCopyByAction: Partial<Record<GraphShowAction, { heading: string; body: string }>> = {
	'enter-compose': {
		heading: 'Compose Better Commits with AI',
		body: 'Let GitLens restructure your changes into clean, well-scoped commits — with clear messages written for you and your team.',
	},
	'enter-review': {
		heading: 'Get an AI Review Before You Push',
		body: 'Catch issues early with a severity-tagged review of your changes — then delegate fixes straight to an agent.',
	},
	'open-compare': {
		heading: 'Compare Branches, Commits, and Worktrees',
		body: 'Compare side-by-side across branches, tags, and commits — right from the visual Commit Graph.',
	},
	'enter-resolve': {
		heading: 'Resolve Conflicts with Confidence',
		body: 'Guided, AI-assisted conflict resolution — see both sides, take the right changes, and finish the merge faster so you can get back to building.',
	},
};

/** Telemetry attribution: a task-specific arrival extends the screen's detail (`signin:review`,
 *  `gate:review`) so conversion can be sliced by task; intentless arrivals keep the bare detail. */
export function getIntentSourceDetail(detail: string, action: GraphShowAction | undefined): string {
	if (action == null || intentCopyByAction[action] == null) return detail;

	return `${detail}:${action.replace(/^(enter|open)-/, '')}`;
}
