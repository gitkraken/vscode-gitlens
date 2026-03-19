import {
	getBranchAutolinks as _getBranchAutolinks,
	ensureCachedBranchNameRegexes,
	ensureCachedRegex,
	getAutolinks,
	isCacheable,
	isDynamic,
	numRegex,
	serializeAutolink,
} from '@gitlens/git/utils/autolink.utils.js';
import { IssuesCloudHostIntegrationId } from '../../../constants.integrations.js';
import type { Autolink, RefSet } from '../../models/autolinks.js';

// Re-export @gitlens/git functions that are identical
export {
	serializeAutolink,
	isDynamic,
	isCacheable,
	ensureCachedRegex,
	ensureCachedBranchNameRegexes,
	numRegex,
	getAutolinks,
};

export const supportedAutolinkIntegrations = [IssuesCloudHostIntegrationId.Jira, IssuesCloudHostIntegrationId.Linear];

export function getBranchAutolinks(branchName: string, refsets: Readonly<RefSet[]>): Map<string, Autolink> {
	const autolinks = new Map<string, Autolink>();

	let num;
	let match;
	// Sort refsets so that issue integrations are checked first for matches
	const sortedRefSets = refsets.toSorted((a, b) => {
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
