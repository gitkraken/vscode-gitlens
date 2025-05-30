import type { IssueOrPullRequest } from '../../git/models/issueOrPullRequest';
import type { ProviderReference } from '../../git/models/remoteProvider';
import type { ResourceDescriptor } from '../../plus/integrations/integration';
import type { MaybePausedResult } from '../../system/promise';

export type AutolinkType = 'issue' | 'pullrequest';
export type AutolinkReferenceType = 'commit' | 'branch';

export interface AutolinkReference {
	/** Short prefix to match to generate autolinks for the external resource */
	readonly prefix: string;
	/** URL of the external resource to link to */
	readonly url: string;
	/** Whether alphanumeric characters should be allowed in `<num>` */
	readonly alphanumeric: boolean;
	/** Whether case should be ignored when matching the prefix */
	readonly ignoreCase: boolean;
	readonly title: string | undefined;

	readonly type?: AutolinkType;
	readonly referenceType?: AutolinkReferenceType;
	readonly description?: string;
	readonly descriptor?: ResourceDescriptor;
}

export interface Autolink extends AutolinkReference {
	provider?: ProviderReference;
	id: string;
	index?: number;

	tokenize?:
		| ((
				text: string,
				outputFormat: 'html' | 'markdown' | 'plaintext',
				tokenMapping: Map<string, string>,
				enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
				prs?: Set<string>,
				footnotes?: Map<number, string>,
		  ) => string)
		| null;
}

export type EnrichedAutolink = [
	issueOrPullRequest: Promise<IssueOrPullRequest | undefined> | undefined,
	autolink: Autolink,
];

export type MaybeEnrichedAutolink = readonly [
	issueOrPullRequest: MaybePausedResult<IssueOrPullRequest | undefined> | undefined,
	autolink: Autolink,
];

export interface CacheableAutolinkReference extends AutolinkReference {
	tokenize?:
		| ((
				text: string,
				outputFormat: 'html' | 'markdown' | 'plaintext',
				tokenMapping: Map<string, string>,
				enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
				prs?: Set<string>,
				footnotes?: Map<number, string>,
		  ) => string)
		| null;

	messageHtmlRegex?: RegExp;
	messageMarkdownRegex?: RegExp;
	messageRegex?: RegExp;
	branchNameRegex?: RegExp;
}

export interface DynamicAutolinkReference {
	tokenize?:
		| ((
				text: string,
				outputFormat: 'html' | 'markdown' | 'plaintext',
				tokenMapping: Map<string, string>,
				enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
				prs?: Set<string>,
				footnotes?: Map<number, string>,
		  ) => string)
		| null;
	parse: (text: string, autolinks: Map<string, Autolink>) => void;
}

export type RefSet = [
	ProviderReference | undefined,
	(AutolinkReference | DynamicAutolinkReference)[] | CacheableAutolinkReference[],
];
