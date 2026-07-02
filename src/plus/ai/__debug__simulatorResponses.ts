import type { AIActionType } from '@gitlens/ai/models/model.js';

const summarized = (summary: string, body: string) => `<summary>${summary}</summary><body>${body}</body>`;

const explainBody = `## Summary
The simulated AI explanation reaches the configured surface end-to-end.

## Highlights
- Wiring verified
- Markdown renders
- Surface receives content`;

const reviewOverviewDefault = `<overview>Simulated review overview. Two focus areas were identified for verification purposes.</overview>
<area severity="suggestion" files="src/example.ts">
<label>Simulated focus area</label>
<rationale>This area exists so the review UI has something to render. Do not interpret semantically.</rationale>
<findings>
<finding severity="suggestion" file="src/example.ts" lines="1-10">
<title>Simulated finding</title>
<description>Placeholder finding content for the live verification flow.</description>
</finding>
</findings>
</area>`;

const reviewDetailDefault = `<findings>
<finding severity="suggestion" file="src/example.ts" lines="1-10">
<title>Simulated detail finding</title>
<description>Placeholder detail finding content for the live verification flow.</description>
</finding>
</findings>`;

// generate-commits has no synthesizable default — the validator demands hunk-index
// conservation against the prompt's hunkMap, which we cannot derive without prompt parsing.
// The out-of-range hunk always fails validation (missing-hunks on a dirty tree, extra-hunks on a
// clean one) — an empty commits array would validate successfully on a clean working tree.
const generateCommitsRejection = `{"commits":[{"message":"simulated","explanation":"simulated","hunks":[{"hunk":-1}]}]}`;

// conflict-resolution is parsed by `@gitkraken/conflict-tools`, not by results.utils.ts, so the
// summary/body fallback below would fail every file and escalate an automatic rebase on its first
// step. A file-level strategy is the one shape that needs no knowledge of the conflict's markers, so
// a single canned response works for any file; confidence clears the 0.8
// `ai.autoRebase.confidenceThreshold` default so a run reaches completion instead of pausing for
// review. Inject per-chunk `chunks` when a test needs the markers resolved individually.
const conflictResolutionDefault = JSON.stringify({
	confidence: 0.9,
	description:
		'Simulated resolution: took the incoming side wholesale. The current side had no meaningful changes relative to the merge base, so replaying the incoming edit as-is loses nothing.',
	strategy: 'theirs',
});

// Plain string-keyed map — TS gets confused by Record/Map when the key union contains a template
// literal (`generate-create-${...}`), even though all keys are valid AIActionType members.
const defaults: { readonly [key: string]: string | undefined } = {
	'explain-changes': summarized('Simulated explanation', explainBody),
	'review-changes': reviewOverviewDefault,
	'generate-commitMessage': summarized('Simulated commit message', 'Deterministic body for verification.'),
	'generate-stashMessage': summarized('Simulated stash message', 'WIP — simulated.'),
	'generate-changelog': summarized('Simulated changelog', '## Changes\n- Simulated entry'),
	'generate-create-cloudPatch': summarized('Simulated cloud patch description', 'Simulated patch body.'),
	'generate-create-pullRequest': summarized('Simulated pull request', '## Summary\n- Simulated PR body'),
	'generate-commits': generateCommitsRejection,
	'generate-searchQuery': 'message:simulated',
	'conflict-resolution': conflictResolutionDefault,
};

export function getDefaultResponse(action: AIActionType): string {
	return defaults[action] ?? `<summary>Unhandled simulated action</summary><body>${action}</body>`;
}

// Used when mode === 'invalid'. Composer's validator rejects the out-of-range hunk (extra-hunks
// retry); parser-tolerant actions will simply render garbage (the documented behavior for that mode).
export function getInvalidResponse(action: AIActionType): string {
	if (action === 'generate-commits') return `{"commits":[{"message":"invalid","hunks":[{"hunk":99999}]}]}`;
	return '<<<malformed simulator output>>>';
}

// Used when the review action is invoked in two-pass detail mode. The action type stays
// 'review-changes' but the consumer is parseReviewDetailResultJson, which falls back to the
// legacy XML parser for these responses — migrate them to JSON when the XML parsers are removed.
export function getReviewDetailDefault(): string {
	return reviewDetailDefault;
}
