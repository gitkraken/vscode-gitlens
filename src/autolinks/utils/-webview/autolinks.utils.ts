import { IssueIntegrationId } from '../../../constants.integrations';
import { escapeMarkdown } from '../../../system/markdown';
import { encodeHtmlWeak, escapeRegex } from '../../../system/string';
import type {
	Autolink,
	AutolinkReference,
	CacheableAutolinkReference,
	DynamicAutolinkReference,
	RefSet,
} from '../../models/autolinks';

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

export const supportedAutolinkIntegrations = [IssueIntegrationId.Jira];

export function isDynamic(ref: AutolinkReference | DynamicAutolinkReference): ref is DynamicAutolinkReference {
	return !('prefix' in ref) && !('url' in ref);
}

function isCacheable(ref: AutolinkReference | DynamicAutolinkReference): ref is CacheableAutolinkReference {
	return 'prefix' in ref && ref.prefix != null && 'url' in ref && ref.url != null;
}

/**
 * Compares autolinks
 * @returns non-0 result that means a probability of the autolink `b` is more relevant of the autolink `a`
 */
function compareAutolinks(a: Autolink, b: Autolink): number {
	// consider that if the number is in the start, it's the most relevant link
	if (b.index === 0) return 1;
	if (a.index === 0) return -1;

	// maybe it worths to use some weight function instead.
	return (
		b.prefix.length - a.prefix.length ||
		b.id.length - a.id.length ||
		(b.index != null && a.index != null ? -(b.index - a.index) : 0)
	);
}

export function ensureCachedRegex(
	ref: Autolink | CacheableAutolinkReference,
	outputFormat: 'html',
): asserts ref is RequireSome<CacheableAutolinkReference, 'messageHtmlRegex'>;
export function ensureCachedRegex(
	ref: Autolink | CacheableAutolinkReference,
	outputFormat: 'markdown',
): asserts ref is RequireSome<CacheableAutolinkReference, 'messageMarkdownRegex'>;
export function ensureCachedRegex(
	ref: Autolink | CacheableAutolinkReference,
	outputFormat: 'plaintext',
): asserts ref is RequireSome<CacheableAutolinkReference, 'messageRegex'>;
export function ensureCachedRegex(
	ref: Autolink | CacheableAutolinkReference,
	outputFormat: 'html' | 'markdown' | 'plaintext',
): void {
	// If the ref is a matched Autolink then only match the exact `id`
	const refPattern = ref.id ? ref.id : ref.alphanumeric ? '\\w+' : '\\d+';
	const refFlags = !ref.id && ref.ignoreCase ? 'gi' : 'g';

	// Regexes matches the ref prefix followed by a token (e.g. #1234)
	if (outputFormat === 'markdown') {
		// Extra `\\\\` in `\\\\\\[` is because the markdown is escaped
		ref.messageMarkdownRegex ??= new RegExp(
			`(^|\\s|\\(|\\[|\\{)(${escapeRegex(encodeHtmlWeak(escapeMarkdown(ref.prefix)))}(${refPattern}))\\b`,
			refFlags,
		);
	} else if (outputFormat === 'html') {
		ref.messageHtmlRegex ??= new RegExp(
			`(^|\\s|\\(|\\[|\\{)(${escapeRegex(encodeHtmlWeak(ref.prefix))}(${refPattern}))\\b`,
			refFlags,
		);
	} else {
		ref.messageRegex ??= new RegExp(`(^|\\s|\\(|\\[|\\{)(${escapeRegex(ref.prefix)}(${refPattern}))\\b`, refFlags);
	}
}

export function ensureCachedBranchNameRegex(
	ref: CacheableAutolinkReference,
): asserts ref is RequireSome<CacheableAutolinkReference, 'branchNameRegex'> {
	ref.branchNameRegex ??= new RegExp(
		`(^|\\-|_|\\.|\\/)(?<prefix>${ref.prefix})(?<issueKeyNumber>${
			ref.alphanumeric ? '\\w' : '\\d'
		}+)(?=$|\\-|_|\\.|\\/)`,
		'gi',
	);
}

export const numRegex = /<num>/g;

export function getAutolinks(message: string, refsets: Readonly<RefSet[]>): Map<string, Autolink> {
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

export function getBranchAutolinks(branchName: string, refsets: Readonly<RefSet[]>): Map<string, Autolink> {
	const autolinks = new Map<string, Autolink>();

	let match;
	let num;
	for (const [provider, refs] of refsets) {
		for (const ref of refs) {
			if (
				!isCacheable(ref) ||
				ref.type === 'pullrequest' ||
				(ref.referenceType && ref.referenceType !== 'branch')
			) {
				continue;
			}

			ensureCachedBranchNameRegex(ref);
			const matches = branchName.matchAll(ref.branchNameRegex);
			do {
				match = matches.next();
				if (!match.value?.groups) break;

				num = match?.value?.groups.issueKeyNumber;
				let index = match.value.index;
				const linkUrl = ref.url?.replace(numRegex, num);
				// strange case (I would say synthetic), but if we parse the link twice, use the most relevant of them
				const existingIndex = autolinks.get(linkUrl)?.index;
				if (existingIndex != null) {
					index = Math.min(index, existingIndex);
				}
				autolinks.set(linkUrl, {
					...ref,
					provider: provider,
					id: num,
					index: index,
					url: linkUrl,
					title: ref.title?.replace(numRegex, num),
					description: ref.description?.replace(numRegex, num),
					descriptor: ref.descriptor,
				});
			} while (!match.done);
		}
	}

	return new Map([...autolinks.entries()].sort((a, b) => compareAutolinks(a[1], b[1])));
}
