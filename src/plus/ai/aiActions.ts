import { explainChanges, explainCommit } from './actions/explainChanges';
import { generateChangelog } from './actions/generateChangelog';
import { generateCommits } from './actions/generateCommits';
import { generateCreateDraft } from './actions/generateCreateDraft';
import { generateCreatePullRequest } from './actions/generateCreatePullRequest';
import { generateCommitMessage, generateStashMessage } from './actions/generateMessage';
import { generateSearchQuery } from './actions/generateSearchQuery';
import type { AIService } from './aiService';

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
	}
}
