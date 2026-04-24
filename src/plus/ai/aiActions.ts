import { explainChanges, explainCommit } from './actions/explainChanges.js';
import { generateChangelog } from './actions/generateChangelog.js';
import { generateCommits } from './actions/generateCommits.js';
import { generateCreateDraft } from './actions/generateCreateDraft.js';
import { generateCreatePullRequest } from './actions/generateCreatePullRequest.js';
import { generateCommitMessage, generateStashMessage } from './actions/generateMessage.js';
import { generateSearchQuery } from './actions/generateSearchQuery.js';
import { reviewChanges, reviewFocusArea, reviewOverview } from './actions/reviewChanges.js';
import type { AIService } from './aiService.js';

type RemoveFirstArg<F> = F extends (first: any, ...args: infer Rest) => infer Return
	? (...args: Rest) => Return
	: never;

export class AIActions {
	readonly explainChanges: RemoveFirstArg<typeof explainChanges>;
	readonly explainCommit: RemoveFirstArg<typeof explainCommit>;
	readonly generateChangelog: RemoveFirstArg<typeof generateChangelog>;
	readonly generateCommitMessage: RemoveFirstArg<typeof generateCommitMessage>;
	readonly generateCommits: RemoveFirstArg<typeof generateCommits>;
	readonly generateCreateDraft: RemoveFirstArg<typeof generateCreateDraft>;
	readonly generateCreatePullRequest: RemoveFirstArg<typeof generateCreatePullRequest>;
	readonly generateSearchQuery: RemoveFirstArg<typeof generateSearchQuery>;
	readonly generateStashMessage: RemoveFirstArg<typeof generateStashMessage>;
	readonly reviewChanges: RemoveFirstArg<typeof reviewChanges>;
	readonly reviewFocusArea: RemoveFirstArg<typeof reviewFocusArea>;
	readonly reviewOverview: RemoveFirstArg<typeof reviewOverview>;

	constructor(service: AIService) {
		this.explainChanges = explainChanges.bind(null, service);
		this.explainCommit = explainCommit.bind(null, service);
		this.generateChangelog = generateChangelog.bind(null, service);
		this.generateCommitMessage = generateCommitMessage.bind(null, service);
		this.generateCommits = generateCommits.bind(null, service);
		this.generateCreateDraft = generateCreateDraft.bind(null, service);
		this.generateCreatePullRequest = generateCreatePullRequest.bind(null, service);
		this.generateSearchQuery = generateSearchQuery.bind(null, service);
		this.generateStashMessage = generateStashMessage.bind(null, service);
		this.reviewChanges = reviewChanges.bind(null, service);
		this.reviewFocusArea = reviewFocusArea.bind(null, service);
		this.reviewOverview = reviewOverview.bind(null, service);
	}
}
