import * as l10n from '@vscode/l10n';
import type { Brand, Unbrand } from '@gitlens/utils/brand.js';
import { memoize } from '@gitlens/utils/decorators/memoize.js';
import { equalsIgnoreCase } from '@gitlens/utils/string.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { Autolink, AutolinkReference, DynamicAutolinkReference } from '../models/autolink.js';
import type { LineRange } from '../models/lineRange.js';
import type {
	ParsedRemoteFileUri,
	RemoteProviderId,
	RemoteProviderSupportedFeatures,
} from '../models/remoteProvider.js';
import { parseRefCandidates, RemoteProvider } from '../models/remoteProvider.js';
import type { CreatePullRequestRemoteResource } from '../models/remoteResource.js';
import type { GkProviderId } from '../models/repositoryIdentities.js';
import type { ResourceDescriptor } from '../models/resourceDescriptor.js';
import type { GitRevisionRangeNotation } from '../models/revision.js';

export interface GitLabRepositoryDescriptor extends ResourceDescriptor {
	owner: string;
	name: string;
}

const autolinkFullIssuesRegex = /\b([^/\s]+\/[^/\s]+?)(?:\\)?#([0-9]+)\b(?!]\()/g;
const autolinkFullMergeRequestsRegex = /\b([^/\s]+\/[^/\s]+?)(?:\\)?!([0-9]+)\b(?!]\()/g;

export class GitLabRemoteProvider extends RemoteProvider<GitLabRepositoryDescriptor> {
	get apiBaseUrl(): string {
		return this.custom ? `${this.protocol}://${this.domain}/api` : `https://${this.domain}/api`;
	}

	protected override get issueLinkPattern(): string {
		return `${this.baseUrl}/-/issues/<num>`;
	}

	private _autolinks: (AutolinkReference | DynamicAutolinkReference)[] | undefined;
	override get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		this._autolinks ??= [
			...super.autolinks,
			{
				prefix: '#',
				url: this.issueLinkPattern,
				alphanumeric: false,
				ignoreCase: false,
				title: l10n.t('Open Issue #{number} on {provider}', { number: '<num>', provider: this.name }),

				type: 'issue',
				description: l10n.t('{provider} Issue #{number}', { provider: this.name, number: '<num>' }),
			},
			{
				prefix: '!',
				url: `${this.baseUrl}/-/merge_requests/<num>`,
				alphanumeric: false,
				ignoreCase: false,
				title: l10n.t('Open Merge Request !{number} on {provider}', {
					number: '<num>',
					provider: this.name,
				}),

				type: 'pullrequest',
				description: l10n.t('{provider} Merge Request !{number}', {
					provider: this.name,
					number: '<num>',
				}),
			},
			{
				descriptors: [
					{
						regex: autolinkFullIssuesRegex,
						url: (repo, num) => `${this.protocol}://${this.domain}/${repo}/-/issues/${num}`,
						title: (repo, num) =>
							l10n.t('Open Issue #{number} from {repository} on {provider}', {
								number: num,
								repository: repo,
								provider: this.name,
							}),
						label: (repo, num) =>
							l10n.t('GitLab Issue {repository}#{number}', { repository: repo, number: num }),
					},
				],
				parse: (text: string, autolinks: Map<string, Autolink>) => {
					let ownerAndRepo: string;
					let num: string;

					let match;
					do {
						match = autolinkFullIssuesRegex.exec(text);
						if (match == null) break;

						[, ownerAndRepo, num] = match;

						const [owner, repo] = ownerAndRepo.split('/', 2);
						autolinks.set(num, {
							provider: this,
							id: num,
							prefix: `${ownerAndRepo}#`,
							url: `${this.protocol}://${this.domain}/${ownerAndRepo}/-/issues/${num}`,
							alphanumeric: false,
							ignoreCase: true,
							title: l10n.t('Open Issue #{number} from {repository} on {provider}', {
								number: '<num>',
								repository: ownerAndRepo,
								provider: this.name,
							}),

							type: 'issue',
							description: l10n.t('{provider} Issue {repository}#{number}', {
								provider: this.name,
								repository: ownerAndRepo,
								number: num,
							}),
							descriptor: {
								key: this.remoteKey,
								owner: owner,
								name: repo,
							} satisfies GitLabRepositoryDescriptor,
						});
					} while (true);
				},
			},
			{
				descriptors: [
					{
						regex: autolinkFullMergeRequestsRegex,
						url: (repo, num) => `${this.protocol}://${this.domain}/${repo}/-/merge_requests/${num}`,
						title: (repo, num) =>
							l10n.t('Open Merge Request !{number} from {repository} on {provider}', {
								number: num,
								repository: repo,
								provider: this.name,
							}),
						label: (repo, num) =>
							l10n.t('{provider} Merge Request {repository}!{number}', {
								provider: this.name,
								repository: repo,
								number: num,
							}),
					},
				],
				parse: (text: string, autolinks: Map<string, Autolink>) => {
					let ownerAndRepo: string;
					let num: string;

					let match;
					do {
						match = autolinkFullMergeRequestsRegex.exec(text);
						if (match == null) break;

						[, ownerAndRepo, num] = match;

						const [owner, repo] = ownerAndRepo.split('/', 2);
						autolinks.set(num, {
							provider: this,
							id: num,
							prefix: `${ownerAndRepo}!`,
							url: `${this.protocol}://${this.domain}/${ownerAndRepo}/-/merge_requests/${num}`,
							alphanumeric: false,
							ignoreCase: true,
							title: l10n.t('Open Merge Request !{number} from {repository} on {provider}', {
								number: '<num>',
								repository: ownerAndRepo,
								provider: this.name,
							}),

							type: 'pullrequest',
							description: l10n.t('{provider} Merge Request !{number} from {repository}', {
								provider: this.name,
								number: num,
								repository: ownerAndRepo,
							}),

							descriptor: {
								key: this.remoteKey,
								owner: owner,
								name: repo,
							} satisfies GitLabRepositoryDescriptor,
						});
					} while (true);
				},
			},
		];
		return this._autolinks;
	}

	override get icon(): string {
		return 'gitlab';
	}

	get id(): RemoteProviderId {
		return 'gitlab';
	}

	get gkProviderId(): GkProviderId {
		return (!equalsIgnoreCase(this.domain, 'gitlab.com')
			? 'gitlabSelfHosted'
			: 'gitlab') satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
	}

	get name(): string {
		return this.formatName('GitLab');
	}

	@memoize()
	override get repoDesc(): GitLabRepositoryDescriptor {
		const [owner, repo] = this.splitPath(this.path);
		return { key: this.remoteKey, owner: owner, name: repo };
	}

	override get supportedFeatures(): RemoteProviderSupportedFeatures {
		return {
			...super.supportedFeatures,
			createPullRequestWithDetails: true,
		};
	}

	private static readonly fileRegex = /^\/([^/]+)\/([^/]+?)\/-\/blob(.+)$/i;
	private static readonly rangeRegex = /^L(\d+)(?:-(\d+))?$/;

	override parseRemoteFileUri(uri: Uri): ParsedRemoteFileUri | undefined {
		if (uri.authority !== this.domain) return undefined;
		if (!uri.path.startsWith(`/${this.path}/`)) return undefined;

		let startLine;
		let endLine;
		if (uri.fragment) {
			const match = GitLabRemoteProvider.rangeRegex.exec(uri.fragment);
			if (match != null) {
				const [, start, end] = match;
				if (start) {
					startLine = parseInt(start, 10);
					if (end) {
						endLine = parseInt(end, 10);
					}
				}
			}
		}

		const match = GitLabRemoteProvider.fileRegex.exec(uri.path);
		if (match == null) return undefined;

		const [, , , path] = match;

		return parseRefCandidates(path, startLine, endLine);
	}

	protected getUrlForBranches(): string {
		return this.encodeUrl(`${this.baseUrl}/-/branches`);
	}

	protected getUrlForBranch(branch: string): string {
		return this.encodeUrl(`${this.baseUrl}/-/tree/${branch}`);
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(`${this.baseUrl}/-/commit/${sha}`);
	}

	protected override getUrlForComparison(base: string, head: string, notation: GitRevisionRangeNotation): string {
		return this.encodeUrl(`${this.baseUrl}/-/compare/${base}${notation}${head}`);
	}

	protected override async getUrlForCreatePullRequest(
		resource: CreatePullRequestRemoteResource,
	): Promise<string | undefined> {
		const { base, head, details } = resource;

		const query = new URLSearchParams({
			utf8: '\u2713',
			'merge_request[source_branch]': head.branch,
			'merge_request[target_branch]': base.branch ?? '',
		});

		if (base.remote.url !== head.remote.url) {
			const repoInfo = await this.context?.getRepositoryInfo?.(this.id, {
				owner: base.remote.path.split('/')[0],
				name: base.remote.path.split('/')[1],
			});
			if (!repoInfo) return undefined;

			query.set('merge_request[target_project_id]', repoInfo.id);
		}

		if (details?.title) {
			query.set('merge_request[title]', details.title);
		}
		if (details?.description) {
			query.set('merge_request[description]', details.description);
		}

		return `${this.encodeUrl(`${this.getRepoBaseUrl(head.remote.path)}/-/merge_requests/new`)}?${query.toString()}`;
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: LineRange): string {
		let line;
		if (range != null) {
			if (range.startLine === range.endLine) {
				line = `#L${range.startLine}`;
			} else {
				line = `#L${range.startLine}-${range.endLine}`;
			}
		} else {
			line = '';
		}

		if (sha) return `${this.encodeUrl(`${this.baseUrl}/-/blob/${sha}/${fileName}`)}${line}`;
		if (branch) return `${this.encodeUrl(`${this.baseUrl}/-/blob/${branch}/${fileName}`)}${line}`;
		return `${this.encodeUrl(`${this.baseUrl}?path=${fileName}`)}${line}`;
	}
}
