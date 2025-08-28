import { IssuesCloudHostIntegrationId } from '../../../constants.integrations';
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

export const supportedAutolinkIntegrations = [IssuesCloudHostIntegrationId.Jira, IssuesCloudHostIntegrationId.Linear];

export function isDynamic(ref: AutolinkReference | DynamicAutolinkReference): ref is DynamicAutolinkReference {
	return !('prefix' in ref) && !('url' in ref);
}

function isCacheable(ref: AutolinkReference | DynamicAutolinkReference): ref is CacheableAutolinkReference {
	return 'prefix' in ref && ref.prefix != null && 'url' in ref && ref.url != null;
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

export function ensureCachedBranchNameRegexes(
	ref: CacheableAutolinkReference,
): asserts ref is RequireSome<CacheableAutolinkReference, 'branchNameRegexes'> {
	if (ref.prefix?.length > 0) {
		ref.branchNameRegexes ??= [
			// Rule 1: Any prefixed ref followed by a 2+ digit number and either a connector or end-of-string after it
			new RegExp(`(?<prefix>${ref.prefix})(?<issueKeyNumber>\\d{2,})(?:[\\/\\-\\_\\.]|$)`, 'i'),
		];
	} else {
		ref.branchNameRegexes ??= [
			// Rule 2: Any 2+ digit number preceded by feature|feat|fix|bug|bugfix|hotfix|issue|ticket with a connector before it, and either a connector or end-of-string after it
			new RegExp(
				`(?:feature|feat|fix|bug|bugfix|hotfix|issue|ticket)(?:\\/#|-#|_#|\\.#|[\\/\\-\\_\\.#])(?<issueKeyNumber>\\d{2,})(?:[\\/\\-\\_\\.]|$)`,
				'i',
			),
			// Rule 3.1: Any 3+ digit number preceded by at least two non-slash, non-numeric characters
			new RegExp(`(?:[^\\d/]{2})(?<issueKeyNumber>\\d{3,})`, 'i'),
			// Rule 3.2: Any 3+ digit number followed by at least two non-slash, non-numeric characters
			new RegExp(`(?<issueKeyNumber>\\d{3,})(?:[^\\d/]{2})`, 'i'),
			// Rule 3.3: A 3+ digit number is the entire branch name
			new RegExp(`^(?<issueKeyNumber>\\d{3,})$`, 'i'),
		];
	}
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

	let num;
	let match;
	// Sort refsets so that issue integrations are checked first for matches
	const sortedRefSets = [...refsets].sort((a, b) => {
		if (a[0]?.id && Object.values<string>(IssuesCloudHostIntegrationId).includes(a[0].id)) {
			return -1;
		}
		if (b[0]?.id && Object.values<string>(IssuesCloudHostIntegrationId).includes(b[0].id)) {
			return 1;
		}
		return 0;
	});

	for (const [provider, refs] of sortedRefSets) {
		for (const ref of refs) {
			if (
				!isCacheable(ref) ||
				ref.type === 'pullrequest' ||
				(ref.referenceType && ref.referenceType !== 'branch')
			) {
				continue;
			}

			ensureCachedBranchNameRegexes(ref);
			for (const regex of ref.branchNameRegexes) {
				match = branchName.match(regex);
				if (!match?.groups) continue;
				num = match.groups.issueKeyNumber;
				const linkUrl = ref.url?.replace(numRegex, num);
				autolinks.set(linkUrl, {
					...ref,
					provider: provider,
					id: num,
					url: linkUrl,
					title: ref.title?.replace(numRegex, num),
					description: ref.description?.replace(numRegex, num),
					descriptor: ref.descriptor,
				});

				// Stop at the first match
				return autolinks;
			}
		}
	}

	return autolinks;
}
