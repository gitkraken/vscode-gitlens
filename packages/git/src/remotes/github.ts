import type { Brand, Unbrand } from '@gitlens/utils/brand.js';
import { memoize } from '@gitlens/utils/decorators/memoize.js';
import { equalsIgnoreCase } from '@gitlens/utils/string.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { parseUri } from '@gitlens/utils/uri.js';
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

const autolinkFullIssuesRegex = /\b([^/\s]+\/[^/\s]+?)(?:\\)?#([0-9]+)\b(?!]\()/g;

function isGitHubDotCom(domain: string): boolean {
	return equalsIgnoreCase(domain, 'github.com');
}

export interface GitHubRepositoryDescriptor extends ResourceDescriptor {
	owner: string;
	name: string;
}

export class GitHubRemoteProvider extends RemoteProvider<GitHubRepositoryDescriptor> {
	override get avatarUri(): Uri {
		return parseUri(`https://avatars.githubusercontent.com/${this.owner}`);
	}

	get apiBaseUrl(): string {
		return this.custom ? `${this.protocol}://${this.domain}/api/v3` : `https://api.${this.domain}`;
	}

	protected override get issueLinkPattern(): string {
		return `${this.baseUrl}/issues/<num>`;
	}

	private _autolinks: (AutolinkReference | DynamicAutolinkReference)[] | undefined;
	override get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		if (this._autolinks === undefined) {
			this._autolinks = [
				...super.autolinks,
				{
					prefix: '#',
					url: this.issueLinkPattern,
					alphanumeric: false,
					ignoreCase: false,
					title: `Open Issue or Pull Request #<num> on ${this.name}`,
					description: `${this.name} Issue or Pull Request #<num>`,
				},
				{
					prefix: 'gh-',
					url: this.issueLinkPattern,
					alphanumeric: false,
					ignoreCase: true,
					title: `Open Issue or Pull Request #<num> on ${this.name}`,
					description: `${this.name} Issue or Pull Request #<num>`,
				},
				{
					descriptors: [
						{
							regex: autolinkFullIssuesRegex,
							url: (repo, num) => `${this.protocol}://${this.domain}/${repo}/issues/${num}`,
							title: (repo, num) => `Open Issue or Pull Request #${num} from ${repo} on ${this.name}`,
							label: (repo, num) => `${this.name} Issue or Pull Request ${repo}#${num}`,
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
								url: `${this.protocol}://${this.domain}/${ownerAndRepo}/issues/${num}`,
								alphanumeric: false,
								ignoreCase: true,
								title: `Open Issue or Pull Request #<num> from ${ownerAndRepo} on ${this.name}`,
								description: `${this.name} Issue or Pull Request ${ownerAndRepo}#${num}`,
								descriptor: {
									key: this.remoteKey,
									owner: owner,
									name: repo,
								} satisfies GitHubRepositoryDescriptor,
							});
						} while (true);
					},
				},
			];
		}
		return this._autolinks;
	}

	override get icon(): string {
		return 'github';
	}

	get id(): RemoteProviderId {
		return 'github';
	}

	get gkProviderId(): GkProviderId {
		return (!isGitHubDotCom(this.domain)
			? 'githubEnterprise'
			: 'github') satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
	}

	get name(): string {
		return this.formatName('GitHub');
	}

	@memoize()
	override get repoDesc(): GitHubRepositoryDescriptor {
		const [owner, repo] = this.splitPath(this.path);
		return { key: this.remoteKey, owner: owner, name: repo };
	}

	override get supportedFeatures(): RemoteProviderSupportedFeatures {
		return {
			...super.supportedFeatures,
			createPullRequestWithDetails: true,
		};
	}

	private static readonly fileRegex = /^\/([^/]+)\/([^/]+?)\/blob(.+)$/i;
	private static readonly rangeRegex = /^L(\d+)(?:-L(\d+))?$/;

	override parseRemoteFileUri(uri: Uri): ParsedRemoteFileUri | undefined {
		if (uri.authority !== this.domain) return undefined;
		if (!uri.path.startsWith(`/${this.path}/`)) return undefined;

		let startLine;
		let endLine;
		if (uri.fragment) {
			const match = GitHubRemoteProvider.rangeRegex.exec(uri.fragment);
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

		const match = GitHubRemoteProvider.fileRegex.exec(uri.path);
		if (match == null) return undefined;

		const [, , , path] = match;

		return parseRefCandidates(path, startLine, endLine);
	}

	protected getUrlForBranch(branch: string): string {
		return this.encodeUrl(`${this.baseUrl}/tree/${branch}`);
	}

	protected getUrlForBranches(): string {
		return this.encodeUrl(`${this.baseUrl}/branches`);
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(`${this.baseUrl}/commit/${sha}`);
	}

	protected override getUrlForComparison(base: string, head: string, notation: GitRevisionRangeNotation): string {
		return this.encodeUrl(`${this.baseUrl}/compare/${base}${notation}${head}`);
	}

	protected override getUrlForCreatePullRequest(
		resource: CreatePullRequestRemoteResource,
	): string | undefined | Promise<string | undefined> {
		const { base, head, details } = resource;

		const query = new URLSearchParams({ expand: '1' });
		if (details?.title) {
			query.set('title', details.title);
		}
		if (details?.description) {
			query.set('body', details.description);
		}

		if (base.remote.url === head.remote.url) {
			return base.branch
				? `${this.encodeUrl(`${this.baseUrl}/compare/${base.branch}...${head.branch}`)}?${query.toString()}`
				: `${this.encodeUrl(`${this.baseUrl}/compare/${head.branch}`)}?${query.toString()}`;
		}

		const [owner] = head.remote.path.split('/', 1);
		return `${this.encodeUrl(
			`${this.baseUrl}/compare/${base.branch ?? 'HEAD'}...${owner}:${head.branch}`,
		)}?${query.toString()}`;
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: LineRange): string {
		let line;
		if (range != null) {
			if (range.startLine === range.endLine) {
				line = `#L${range.startLine}`;
			} else {
				line = `#L${range.startLine}-L${range.endLine}`;
			}
		} else {
			line = '';
		}

		if (sha) return `${this.encodeUrl(`${this.baseUrl}/blob/${sha}/${fileName}`)}${line}`;
		if (branch) return `${this.encodeUrl(`${this.baseUrl}/blob/${branch}/${fileName}`)}${line}`;
		return `${this.encodeUrl(`${this.baseUrl}?path=${fileName}`)}${line}`;
	}
}

const gitHubNoReplyAddressRegex = /^(?:(\d+)\+)?([a-zA-Z\d-]{1,39})@users\.noreply\.(.*)$/i;

export function getGitHubNoReplyAddressParts(
	email: string,
): { userId: string; login: string; authority: string } | undefined {
	const match = gitHubNoReplyAddressRegex.exec(email);
	if (match == null) return undefined;

	const [, userId, login, authority] = match;
	return { userId: userId, login: login, authority: authority };
}
