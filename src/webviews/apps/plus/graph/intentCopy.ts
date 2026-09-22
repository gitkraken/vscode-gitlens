import * as l10n from '@vscode/l10n';
import type { GraphIntent, GraphIntentKind } from '../../../plus/graph/protocol.js';

export interface GraphIntentCopy {
	heading: string;
	body: string;
	/** Screen-neutral confirmation that the task the user started is still queued. Deliberately free
	 *  of "after signing in" / "after upgrading" so one string serves both walls. `message` is a
	 *  literal l10n string that may carry `{subject}` / `{subject2}` placeholders — the screens fill
	 *  them via `localizedContent` so the ref or path renders as a code token. */
	promise?: { message: string; subject?: string; subject2?: string };
}

/** The shared pitch behind every "reveal this ref" arrival — a commit, branch, tag, or stash all
 *  land on the same graph, so only the promise line's noun differs. One definition keeps the four
 *  from drifting apart, and the catalog from growing four copies of the same sentence. */
function revealCopy(promise: GraphIntentCopy['promise']): GraphIntentCopy {
	return {
		heading: l10n.t('See Any Commit in Context'),
		body: l10n.t(
			'Jump straight to a commit, branch, or tag and see its full history — where it branched, what it touched, and what landed around it.',
		),
		promise: promise,
	};
}

/** Task-specific access messaging (#5534, expanded in #5820): when a specific task brought the user to
 *  an access wall, the heading + body confirm that gaining access completes THAT task, and the promise
 *  names the task's own subject. Bodies are CTA-free so the signed-out sign-in screen and the signed-in
 *  plan gate can share one string — each screen's own buttons carry the verb.
 *
 *  Returns `undefined` for an intentless arrival, which leaves both walls on their generic pitch. */
export function getIntentCopy(intent: GraphIntent | undefined): GraphIntentCopy | undefined {
	if (intent == null) return undefined;

	// An empty subject would render "Commit  will open…" — drop the promise instead (except
	// `scope-to-branch`, whose subject is genuinely optional and has its own fallback below).
	const subject = intent.subject != null && intent.subject.length > 0 ? intent.subject : undefined;
	const subject2 = intent.subject2 != null && intent.subject2.length > 0 ? intent.subject2 : undefined;

	switch (intent.kind) {
		case 'show-commit':
			return revealCopy(
				subject != null
					? { message: l10n.t('Commit {subject} will open in the Commit Graph.'), subject: subject }
					: undefined,
			);
		case 'show-branch':
			return revealCopy(
				subject != null
					? { message: l10n.t('Branch {subject} will open in the Commit Graph.'), subject: subject }
					: undefined,
			);
		case 'show-tag':
			return revealCopy(
				subject != null
					? { message: l10n.t('Tag {subject} will open in the Commit Graph.'), subject: subject }
					: undefined,
			);
		case 'show-stash':
			return revealCopy(
				subject != null
					? { message: l10n.t('Stash {subject} will open in the Commit Graph.'), subject: subject }
					: undefined,
			);
		case 'show-file-history':
		case 'show-folder-history':
			return {
				heading: l10n.t("Trace a File's Full History"),
				body: l10n.t(
					'Follow every commit that touched a file or folder — across branches, merges, and renames — in one visual timeline.',
				),
				promise:
					subject != null
						? {
								message: l10n.t('The history of {subject} will open in the Commit Graph.'),
								subject: subject,
							}
						: undefined,
			};
		case 'open-compare':
			return {
				heading: l10n.t('Compare Branches, Commits, and Worktrees'),
				body: l10n.t(
					'Compare side-by-side across branches, tags, and commits — right from the visual Commit Graph.',
				),
				promise:
					subject != null && subject2 != null
						? {
								message: l10n.t(
									'The comparison of {subject} and {subject2} will open in the Commit Graph.',
								),
								subject: subject,
								subject2: subject2,
							}
						: undefined,
			};
		case 'show-wip':
			return {
				heading: l10n.t('All Your Working Changes, Together'),
				body: l10n.t(
					"See every worktree's uncommitted work — and any paused merge or rebase — in one view, with the next step ready for each.",
				),
				promise: { message: l10n.t('Your working changes will open in the Commit Graph.') },
			};
		case 'scope-to-branch':
			return {
				heading: l10n.t('Focus the Graph on One Branch'),
				body: l10n.t(
					'Cut the noise to just the commits that belong to a branch or worktree — the bigger picture stays one click away.',
				),
				// Subject is genuinely optional here (see `DidRequestGraphActionParams.scopeBranch` —
				// absent means focus the current branch), so it falls back rather than dropping the promise.
				promise:
					subject != null
						? { message: l10n.t('The Commit Graph will focus on {subject}.'), subject: subject }
						: { message: l10n.t('The Commit Graph will focus on your current branch.') },
			};
		case 'show-rebase-summary':
			return {
				heading: l10n.t('See What the Automatic Rebase Changed'),
				body: l10n.t(
					'A commit-by-commit summary of an automatic rebase — what replayed cleanly, what was resolved for you, and what still needs a look.',
				),
				promise: { message: l10n.t('The rebase summary will open in the Commit Graph.') },
			};
		case 'enter-compose':
			return {
				heading: l10n.t('Compose Better Commits with AI'),
				body: l10n.t(
					'Let GitLens restructure your changes into clean, well-scoped commits — with clear messages written for you and your team.',
				),
			};
		case 'enter-review':
			return {
				heading: l10n.t('Get an AI Review Before You Push'),
				body: l10n.t(
					'Catch issues early with a severity-tagged review of your changes — then delegate fixes straight to an agent.',
				),
			};
		case 'enter-resolve':
			return {
				heading: l10n.t('Resolve Conflicts with Confidence'),
				body: l10n.t(
					'Guided, AI-assisted conflict resolution — see both sides, take the right changes, and finish the merge faster so you can get back to building.',
				),
			};
	}
}

const intentTelemetryDetails: Record<GraphIntentKind, string> = {
	'show-commit': 'commit',
	'show-branch': 'branch',
	'show-tag': 'tag',
	'show-stash': 'stash',
	'show-file-history': 'file-history',
	'show-folder-history': 'folder-history',
	'open-compare': 'compare',
	'show-wip': 'wip',
	'scope-to-branch': 'scope',
	'show-rebase-summary': 'rebase-summary',
	'enter-compose': 'compose',
	'enter-review': 'review',
	'enter-resolve': 'resolve',
};

/** The task slug an arrival is attributed to, or `undefined` for an intentless one. Shared by the
 *  CONVERSION detail below and the sign-in screen's IMPRESSION event, so the funnel's numerator and
 *  denominator are keyed identically — slicing conversion rate by task needs both. */
export function getIntentTelemetryDetail(intent: GraphIntent | undefined): string | undefined {
	if (intent == null || getIntentCopy(intent) == null) return undefined;

	return intentTelemetryDetails[intent.kind];
}

/** Telemetry attribution: a task-specific arrival extends the screen's detail (`signin:review`,
 *  `gate:review`) so conversion can be sliced by task; intentless arrivals keep the bare detail. */
export function getIntentSourceDetail(detail: string, intent: GraphIntent | undefined): string {
	const slug = getIntentTelemetryDetail(intent);
	if (slug == null) return detail;

	return `${detail}:${slug}`;
}
