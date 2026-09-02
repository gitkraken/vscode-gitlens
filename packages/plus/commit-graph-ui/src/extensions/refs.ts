import type { CommitGraphRefsExtension } from '../profile.js';
import {
	createRefAdornmentProvider,
	renderIssueTooltipCard,
	renderPullRequestTooltipCard,
	renderRefPill,
	toParsedRefs,
} from './refs/adornmentProvider.js';

export const refsExtension: CommitGraphRefsExtension = Object.freeze({
	createProvider: createRefAdornmentProvider,
	toParsedRefs: toParsedRefs,
	renderPill: renderRefPill,
	renderPullRequestTooltip: renderPullRequestTooltipCard,
	renderIssueTooltip: renderIssueTooltipCard,
});
