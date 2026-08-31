import {
	createRefAdornmentProvider,
	renderIssueTooltipCard,
	renderPullRequestTooltipCard,
	renderRefPill,
	toParsedRefs,
} from '../adornments/refAdornmentProvider.js';
import type { CommitGraphRefsExtension } from '../runtime.js';

export const refsExtension: CommitGraphRefsExtension = Object.freeze({
	id: 'refs',
	createProvider: createRefAdornmentProvider,
	toParsedRefs: toParsedRefs,
	renderPill: renderRefPill,
	renderPullRequestTooltip: renderPullRequestTooltipCard,
	renderIssueTooltip: renderIssueTooltipCard,
});
