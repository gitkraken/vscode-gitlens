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
// Returning an obviously-rejected payload makes the no-inject failure mode predictable.
const generateCommitsRejection = `{"commits":[]}`;

// Plain string-keyed map — TS gets confused by Record/Map when the key union contains a template
// literal (`generate-create-${...}`), even though all keys are valid AIActionType members.
const defaults: { readonly [key: string]: string | undefined } = {
	'explain-changes': summarized('Simulated explanation', explainBody),
	'review-changes': reviewOverviewDefault,
	'generate-commitMessage': summarized('Simulated commit message', 'Deterministic body for verification.'),
	'generate-stashMessage': summarized('Simulated stash message', 'WIP — simulated.'),
	'generate-changelog': summarized('Simulated changelog', '## Changes\n- Simulated entry'),
	'generate-create-cloudPatch': summarized('Simulated cloud patch description', 'Simulated patch body.'),
	'generate-create-codeSuggestion': summarized('Simulated code suggestion', 'Simulated suggestion body.'),
	'generate-create-pullRequest': summarized('Simulated pull request', '## Summary\n- Simulated PR body'),
	'generate-commits': generateCommitsRejection,
	'generate-searchQuery': 'message:simulated',
};

export function getDefaultResponse(action: AIActionType): string {
	return defaults[action] ?? `<summary>Unhandled simulated action</summary><body>${action}</body>`;
}

// Used when mode === 'invalid'. Composer's validator will reject this; parser-tolerant
// actions will simply render garbage (which is the documented behavior for that mode).
export function getInvalidResponse(action: AIActionType): string {
	if (action === 'generate-commits') return `{"commits":[{"message":"invalid","hunks":[{"hunk":99999}]}]}`;
	return '<<<malformed simulator output>>>';
}

// Used when the review action is invoked in two-pass detail mode. The action type stays
// 'review-changes' but the consumer is parseReviewDetailResult, which expects findings.
export function getReviewDetailDefault(): string {
	return reviewDetailDefault;
}
