import type { HostingServiceType } from '@gitlens/utils/hostingServiceType.js';

/** A remote's hosting-provider glicon from its hosting service type; `cloud` for an unrecognized/absent
 *  provider. */
export function remoteRefIcon(hostingServiceType: HostingServiceType | undefined): string {
	switch (hostingServiceType) {
		case 'github':
		case 'githubEnterprise':
			return 'gl-provider-github';
		case 'gitlab':
		case 'gitlabSelfHosted':
			return 'gl-provider-gitlab';
		case 'bitbucket':
		case 'bitbucketServer':
			return 'gl-provider-bitbucket';
		case 'azureDevops':
			return 'gl-provider-azdo';
		default:
			return 'cloud';
	}
}

export type AutolinkIconType = 'autolink' | 'issue' | 'pr';
export type AutolinkIconStatus = 'opened' | 'closed' | 'merged';

export function getAutolinkIcon(
	type: AutolinkIconType = 'autolink',
	status: AutolinkIconStatus = 'merged',
	isDraft: boolean = false,
): { icon: string; modifier: string } {
	if (type === 'issue') {
		switch (status) {
			case 'closed':
				return { icon: 'pass', modifier: 'issue-closed' };
			case 'opened':
				return { icon: 'issues', modifier: 'issue-opened' };
			default:
				return { icon: 'issues', modifier: 'issue' };
		}
	}

	if (type === 'pr') {
		switch (status) {
			case 'merged':
				return { icon: 'git-merge', modifier: 'pr-merged' };
			case 'closed':
				return { icon: 'git-pull-request-closed', modifier: 'pr-closed' };
			default:
				return isDraft
					? { icon: 'git-pull-request-draft', modifier: 'pr-draft' }
					: { icon: 'git-pull-request', modifier: 'pr-opened' };
		}
	}
	return { icon: 'link', modifier: '' };
}
