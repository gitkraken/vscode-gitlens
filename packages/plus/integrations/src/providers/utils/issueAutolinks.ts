import * as l10n from '@vscode/l10n';
import type { AutolinkReference } from '@gitlens/git/models/autolink.js';
import type { ResourceDescriptor } from '@gitlens/git/models/resourceDescriptor.js';

export function createIssueAutolinkReferences(
	key: string,
	url: string,
	resource: ResourceDescriptor & { name: string },
): AutolinkReference[] {
	const dashedPrefix = `${key}-`;
	return [dashedPrefix, `${key}_`].map<AutolinkReference>(prefix => ({
		prefix: prefix,
		url: url,
		alphanumeric: false,
		ignoreCase: false,
		referenceType: prefix === dashedPrefix ? undefined : 'branch',
		title: l10n.t('Open Issue {0} on {1}', `${dashedPrefix}<num>`, resource.name),
		type: 'issue',
		description: l10n.t('{0} Issue {1}', resource.name, `${dashedPrefix}<num>`),
		descriptor: { ...resource },
	}));
}
