import type { ProviderReference } from './remoteProvider.js';
import type { ResourceDescriptor } from './resourceDescriptor.js';

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

export interface Autolink extends Omit<CacheableAutolinkReference, 'id'> {
	provider?: ProviderReference;
	id: string;
}

export interface CacheableAutolinkReference extends AutolinkReference {
	id?: never;

	messageHtmlRegex?: RegExp;
	messageMarkdownRegex?: RegExp;
	messageRegex?: RegExp;
	branchNameRegexes?: RegExp[];
}

/** Metadata for rendering a dynamic autolink pattern in text */
export interface DynamicAutolinkDescriptor {
	/** Regex with /g flag. Must capture groups: (fullMatch, repo, num) */
	readonly regex: RegExp;
	/** Builds URL from matched groups. Receives raw matched text — renderer handles escaping. */
	readonly url: (repo: string, num: string) => string;
	/** Hover title for the link */
	readonly title: (repo: string, num: string) => string;
	/** Label for footnotes */
	readonly label: (repo: string, num: string) => string;
}

export interface DynamicAutolinkReference {
	parse: (text: string, autolinks: Map<string, Autolink>) => void;
	/** Descriptors for rendering dynamic autolinks in text. If absent, dynamic autolinks are parsed but not rendered as links. */
	readonly descriptors?: readonly DynamicAutolinkDescriptor[];
}

export type RefSet = [
	ProviderReference | undefined,
	(AutolinkReference | DynamicAutolinkReference)[] | CacheableAutolinkReference[],
];
