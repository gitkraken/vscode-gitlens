import slugify from 'slugify';
import { IssueIntegrationId } from '../constants.integrations';
import type { IssueOrPullRequest } from '../git/models/issue';
import type { ProviderReference } from '../git/models/remoteProvider';
import type { ResourceDescriptor } from '../plus/integrations/integration';
import { flatMap, forEach } from '../system/iterable';
import { escapeMarkdown } from '../system/markdown';
import type { MaybePausedResult } from '../system/promise';
import { encodeHtmlWeak, escapeRegex } from '../system/string';

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
	priority?: string;

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

export function serializeAutolink(value: Autolink): Autolink {
	const serialized: Autolink = {
		provider: value.provider
			? {
					id: value.provider.id,
					name: value.provider.name,
					domain: value.provider.domain,
					icon: value.provider.icon,
			  }
			: undefined,
		id: value.id,
		index: value.index,
		prefix: value.prefix,
		url: value.url,
		alphanumeric: value.alphanumeric,
		ignoreCase: value.ignoreCase,
		title: value.title,
		type: value.type,
		description: value.description,
		descriptor: value.descriptor,
	};
	return serialized;
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

export const supportedAutolinkIntegrations = [IssueIntegrationId.Jira];

export function isDynamic(ref: AutolinkReference | DynamicAutolinkReference): ref is DynamicAutolinkReference {
	return !('prefix' in ref) && !('url' in ref);
}

export function isCacheable(ref: AutolinkReference | DynamicAutolinkReference): ref is CacheableAutolinkReference {
	return 'prefix' in ref && ref.prefix != null && 'url' in ref && ref.url != null;
}

export type RefSet = [
	ProviderReference | undefined,
	(AutolinkReference | DynamicAutolinkReference)[] | CacheableAutolinkReference[],
];

/**
 * Compares autolinks
 * @returns non-0 result that means a probability of the autolink `b` is more relevant of the autolink `a`
 */
function compareAutolinks(a: Autolink, b: Autolink): number {
	// believe that link with prefix is definitely more relevant that just a number
	if (b.prefix.length - a.prefix.length) {
		return b.prefix.length - a.prefix.length;
	}
	// if custom priority provided, let's consider it first
	if (a.priority || b.priority) {
		if ((b.priority ?? '') > (a.priority ?? '')) {
			return 1;
		}
		if ((b.priority ?? '') < (a.priority ?? '')) {
			return -1;
		}
	}
	// consider that if the number is in the start, it's the most relevant link
	if (b.index === 0) return 1;
	if (a.index === 0) return -1;

	// maybe it worths to use some weight function instead.
	return b.id.length - a.id.length || (b.index != null && a.index != null ? -(b.index - a.index) : 0);
}

function ensureCachedRegex(
	ref: CacheableAutolinkReference,
	outputFormat: 'html',
): asserts ref is RequireSome<CacheableAutolinkReference, 'messageHtmlRegex'>;
function ensureCachedRegex(
	ref: CacheableAutolinkReference,
	outputFormat: 'markdown',
): asserts ref is RequireSome<CacheableAutolinkReference, 'messageMarkdownRegex'>;
function ensureCachedRegex(
	ref: CacheableAutolinkReference,
	outputFormat: 'plaintext',
): asserts ref is RequireSome<CacheableAutolinkReference, 'messageRegex' | 'branchNameRegex'>;
function ensureCachedRegex(ref: CacheableAutolinkReference, outputFormat: 'html' | 'markdown' | 'plaintext') {
	// Regexes matches the ref prefix followed by a token (e.g. #1234)
	if (outputFormat === 'markdown' && ref.messageMarkdownRegex == null) {
		// Extra `\\\\` in `\\\\\\[` is because the markdown is escaped
		ref.messageMarkdownRegex = new RegExp(
			`(^|\\s|\\(|\\[|\\{)(${escapeRegex(encodeHtmlWeak(escapeMarkdown(ref.prefix)))}(${
				ref.alphanumeric ? '\\w' : '\\d'
			}+))\\b`,
			ref.ignoreCase ? 'gi' : 'g',
		);
	} else if (outputFormat === 'html' && ref.messageHtmlRegex == null) {
		ref.messageHtmlRegex = new RegExp(
			`(^|\\s|\\(|\\[|\\{)(${escapeRegex(encodeHtmlWeak(ref.prefix))}(${ref.alphanumeric ? '\\w' : '\\d'}+))\\b`,
			ref.ignoreCase ? 'gi' : 'g',
		);
	} else if (ref.messageRegex == null) {
		ref.messageRegex = new RegExp(
			`(^|\\s|\\(|\\[|\\{)(${escapeRegex(ref.prefix)}(${ref.alphanumeric ? '\\w' : '\\d'}+))\\b`,
			ref.ignoreCase ? 'gi' : 'g',
		);
		if (!ref.prefix && !ref.alphanumeric) {
			// use a different regex for non-prefixed refs
			ref.branchNameRegex =
				/(?<numberChunkBeginning>^|\/|-|_)(?<numberChunk>(?<issueKeyNumber>\d+)(((-|\.|_)\d+){0,1}))(?<numberChunkEnding>$|\/|-|_)/gi;
		} else {
			ref.branchNameRegex = new RegExp(
				`(^|\\-|_|\\.|\\/)(?<prefix>${ref.prefix})(?<issueKeyNumber>${
					ref.alphanumeric ? '\\w' : '\\d'
				}+)(?=$|\\-|_|\\.|\\/)`,
				'gi',
			);
		}
	}

	return true;
}

export { ensureCachedRegex };

export const numRegex = /<num>/g;

export function getAutolinks(message: string, refsets: Readonly<RefSet[]>) {
	const autolinks = new Map<string, Autolink>();

	let match;
	let num;
	for (const [provider, refs] of refsets) {
		for (const ref of refs) {
			if (!isCacheable(ref) || (ref.referenceType && ref.referenceType !== 'commit')) {
				if (isDynamic(ref)) {
					ref.parse(message, autolinks);
				}
				continue;
			}

			ensureCachedRegex(ref, 'plaintext');

			do {
				match = ref.messageRegex.exec(message);
				if (!match) break;

				[, , , num] = match;

				autolinks.set(num, {
					provider: provider,
					id: num,
					index: match.index,
					prefix: ref.prefix,
					url: ref.url?.replace(numRegex, num),
					alphanumeric: ref.alphanumeric,
					ignoreCase: ref.ignoreCase,
					title: ref.title?.replace(numRegex, num),
					type: ref.type,
					description: ref.description?.replace(numRegex, num),
					descriptor: ref.descriptor,
				});
			} while (true);
		}
	}

	return autolinks;
}

/** returns lexicographic priority value ready to sort */
export function calculatePriority(
	issueKey: string,
	edgeDistance: number,
	numberGroup: string,
	chunkIndex: number = 0,
): string {
	const isSingleNumber = issueKey === numberGroup;
	return `
		${String.fromCharCode('a'.charCodeAt(0) + chunkIndex)}:\
		${String.fromCharCode('a'.charCodeAt(0) - edgeDistance)}:\
		${String.fromCharCode('a'.charCodeAt(0) + Number(isSingleNumber))}:\
		${String.fromCharCode('a'.charCodeAt(0) + Number(issueKey))}
	`;
}

export function getBranchAutolinks(branchName: string, refsets: Readonly<RefSet[]>) {
	const autolinks = new Map<string, Autolink>();

	let match;
	for (const [provider, refs] of refsets) {
		for (const ref of refs) {
			if (
				!isCacheable(ref) ||
				ref.type === 'pullrequest' ||
				(ref.referenceType && ref.referenceType !== 'branch')
			) {
				continue;
			}

			ensureCachedRegex(ref, 'plaintext');
			let chunks = [branchName];
			// use more complex logic for refs with no prefix
			const nonPrefixedRef = !ref.prefix && !ref.alphanumeric;
			if (nonPrefixedRef) {
				chunks = branchName.split('/');
			}
			let chunkIndex = 0;
			const chunkIndexMap = new Map<string, number>();
			let skip = false;
			// know chunk indexes, skip release-like chunks or chunk pairs like release-1 or release/1
			let matches: IterableIterator<RegExpExecArray> | undefined = flatMap(chunks, chunk => {
				const releaseMatch = /^(v|ver?|versions?|releases?)((?<releaseNum>[\d.-]+)?)$/gm.exec(chunk);
				if (releaseMatch) {
					// number in the next chunk should be ignored
					if (!releaseMatch.groups?.releaseNum) {
						skip = true;
					}
					return [];
				}
				if (skip) {
					skip = false;
					return [];
				}
				const match = chunk.matchAll(ref.branchNameRegex);
				chunkIndexMap.set(chunk, chunkIndex++);
				return match;
			});
			/** additional matches list to skip numbers that are mentioned inside the ref title */
			const refTitlesMatches: IterableIterator<RegExpExecArray>[] = [];
			/** indicates that we should remove any matched link from the map */
			let unwanted = false;
			do {
				match = matches?.next();
				if (match?.done && refTitlesMatches.length) {
					// check ref titles on unwanted matches
					matches = refTitlesMatches.shift();
					unwanted = true;
					continue;
				}
				if (!match?.value?.groups) break;

				const { issueKeyNumber: issueKey, numberChunk = issueKey } = match.value.groups;
				const input = match.value.input;
				let index = match.value.index;
				const entryEdgeDistance = Math.min(index, input.length - index - numberChunk.length - 1);

				const linkUrl = ref.url?.replace(numRegex, issueKey);
				// strange case (I would say synthetic), but if we parse the link twice, use the most relevant of them
				const existingIndex = autolinks.get(linkUrl)?.index;
				if (existingIndex != null) {
					index = Math.min(index, existingIndex);
				}

				// fill refTitlesMatches for non-prefixed refs
				if (!unwanted && nonPrefixedRef && ref.title) {
					refTitlesMatches.push(slugify(ref.title).matchAll(ref.branchNameRegex));
				}

				if (!unwanted) {
					autolinks.set(linkUrl, {
						...ref,
						provider: provider,
						id: issueKey,
						index: index,
						url: linkUrl,
						priority: nonPrefixedRef
							? calculatePriority(
									issueKey,
									entryEdgeDistance,
									match.value.groups.numberChunk,
									chunkIndexMap.get(match.value.input),
							  )
							: undefined,
						title: ref.title?.replace(numRegex, issueKey),
						description: ref.description?.replace(numRegex, issueKey),
						descriptor: ref.descriptor,
					});
				} else {
					autolinks.delete(linkUrl);
				}
			} while (true);
		}
	}

	return new Map([...autolinks.entries()].sort((a, b) => compareAutolinks(a[1], b[1])));
}
