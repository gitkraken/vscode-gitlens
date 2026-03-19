import type { Brand, Unbrand } from '@gitlens/utils/brand.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { RemoteProviderContext } from '../context.js';
import type { AutolinkReference, DynamicAutolinkReference } from '../models/autolink.js';
import type { LineRange } from '../models/lineRange.js';
import type {
	ParsedRemoteFileUri,
	RemoteProviderId,
	RemoteProviderSupportedFeatures,
} from '../models/remoteProvider.js';
import { parseRefCandidates, RemoteProvider } from '../models/remoteProvider.js';
import type { CreatePullRequestRemoteResource } from '../models/remoteResource.js';
import type { GkProviderId } from '../models/repositoryIdentities.js';
import type { GitRevisionRangeNotation } from '../models/revision.js';

export class BitbucketServerRemoteProvider extends RemoteProvider {
	constructor(
		domain: string,
		path: string,
		protocol?: string,
		name?: string,
		custom: boolean = false,
		context?: RemoteProviderContext,
	) {
		super(domain, path, protocol, name, custom, context);
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
					prefix: 'issue #',
					url: this.issueLinkPattern,
					alphanumeric: false,
					ignoreCase: true,
					title: `Open Issue #<num> on ${this.name}`,

					type: 'issue',
					description: `${this.name} Issue #<num>`,
				},
				{
					prefix: 'pull request #',
					url: `${this.baseUrl}/pull-requests/<num>`,
					alphanumeric: false,
					ignoreCase: true,
					title: `Open Pull Request #<num> on ${this.name}`,

					type: 'pullrequest',
					description: `${this.name} Pull Request #<num>`,
				},
			];
		}
		return this._autolinks;
	}

	protected override get baseUrl(): string {
		const [project, repo] = this.splitPath(this.path);
		return `${this.protocol}://${this.domain}/projects/${project}/repos/${repo}`;
	}

	protected override splitPath(path: string): [string, string] {
		if (path.startsWith('scm/') && path.indexOf('/') !== path.lastIndexOf('/')) {
			return super.splitPath(path.replace('scm/', ''));
		}

		return super.splitPath(path);
	}

	override get icon(): string {
		return 'bitbucket';
	}

	get id(): RemoteProviderId {
		return 'bitbucket-server';
	}

	get gkProviderId(): GkProviderId {
		return 'bitbucketServer' satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
	}

	get name(): string {
		return this.formatName('Bitbucket Server');
	}

	override get supportedFeatures(): RemoteProviderSupportedFeatures {
		return {
			...super.supportedFeatures,
			createPullRequestWithDetails: true,
		};
	}

	private static readonly fileRegex = /^\/([^/]+)\/([^/]+?)\/src(.+)$/i;
	private static readonly rangeRegex = /^lines-(\d+)(?::(\d+))?$/;

	override parseRemoteFileUri(uri: Uri): ParsedRemoteFileUri | undefined {
		if (uri.authority !== this.domain) return undefined;
		if (!uri.path.startsWith(`/${this.path}/`)) return undefined;

		let startLine;
		let endLine;
		if (uri.fragment) {
			const match = BitbucketServerRemoteProvider.rangeRegex.exec(uri.fragment);
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

		const match = BitbucketServerRemoteProvider.fileRegex.exec(uri.path);
		if (match == null) return undefined;

		const [, , , path] = match;

		return parseRefCandidates(path, startLine, endLine);
	}

	protected getUrlForBranches(): string {
		return this.encodeUrl(`${this.baseUrl}/branches`);
	}

	protected getUrlForBranch(branch: string): string {
		return this.encodeUrl(`${this.baseUrl}/commits?until=${branch}`);
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(`${this.baseUrl}/commits/${sha}`);
	}

	protected override getUrlForComparison(base: string, head: string, _notation: GitRevisionRangeNotation): string {
		return this.encodeUrl(`${this.baseUrl}/branches/compare/${head}\r${base}`);
	}

	protected override async getUrlForCreatePullRequest(
		resource: CreatePullRequestRemoteResource,
	): Promise<string | undefined> {
		const { base, head, details } = resource;

		const query = new URLSearchParams({ sourceBranch: head.branch, targetBranch: base.branch ?? '' });

		if (base.remote.url !== head.remote.url) {
			const [baseOwner, baseName] = this.splitPath(base.remote.path);
			const repoInfo = await this.context?.getRepositoryInfo?.(this.id, {
				owner: baseOwner,
				name: baseName,
			});
			if (!repoInfo) return undefined;

			query.set('targetRepoId', repoInfo.id);
		}

		if (details?.title) {
			query.set('title', details.title);
		}
		if (details?.description) {
			query.set('description', details.description);
		}

		const [headOwner, headName] = this.splitPath(head.remote.path);
		return `${this.encodeUrl(
			`${this.protocol}://${this.domain}/projects/${headOwner}/repos/${headName}/pull-requests?create`,
		)}&${query.toString()}`;
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: LineRange): string {
		let line;
		if (range != null) {
			if (range.startLine === range.endLine) {
				line = `#${range.startLine}`;
			} else {
				line = `#${range.startLine}-${range.endLine}`;
			}
		} else {
			line = '';
		}

		if (sha) return `${this.encodeUrl(`${this.baseUrl}/browse/${fileName}?at=${sha}`)}${line}`;
		if (branch) return `${this.encodeUrl(`${this.baseUrl}/browse/${fileName}?at=${branch}`)}${line}`;
		return `${this.encodeUrl(`${this.baseUrl}/browse/${fileName}`)}${line}`;
	}
}
