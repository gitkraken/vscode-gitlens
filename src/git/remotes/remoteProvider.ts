import type { Range, Uri } from 'vscode';
import { env } from 'vscode';
import type { AutolinkReference, DynamicAutolinkReference } from '../../autolinks/models/autolinks';
import type { Source } from '../../constants.telemetry';
import type { ResourceDescriptor } from '../../plus/integrations/integration';
import { openUrl } from '../../system/-webview/vscode/uris';
import { memoize } from '../../system/decorators/-webview/memoize';
import { encodeUrl } from '../../system/encoding';
import { getSettledValue } from '../../system/promise';
import type { ProviderReference } from '../models/remoteProvider';
import type { CreatePullRequestRemoteResource, RemoteResource } from '../models/remoteResource';
import { RemoteResourceType } from '../models/remoteResource';
import type { Repository } from '../models/repository';
import type { GkProviderId } from '../models/repositoryIdentities';
import type { GitRevisionRangeNotation } from '../models/revision';

export type RemoteProviderId =
	| 'azure-devops'
	| 'bitbucket'
	| 'bitbucket-server'
	| 'custom'
	| 'gerrit'
	| 'gitea'
	| 'github'
	| 'cloud-github-enterprise' // TODO@eamodio this shouldn't really be here, since it's not a valid remote provider id
	| 'cloud-gitlab-self-hosted' // TODO@eamodio this shouldn't really be here, since it's not a valid remote provider id
	| 'gitlab'
	| 'google-source';

export interface LocalInfoFromRemoteUriResult {
	uri: Uri;

	repoPath: string;
	rev: string | undefined;

	startLine?: number;
	endLine?: number;
}

export interface RemoteProviderSupportedFeatures {
	createPullRequestWithDetails?: boolean;
}

export abstract class RemoteProvider<T extends ResourceDescriptor = ResourceDescriptor> implements ProviderReference {
	protected readonly _name: string | undefined;

	constructor(
		public readonly domain: string,
		public readonly path: string,
		public readonly protocol: string = 'https',
		name?: string,
		public readonly custom: boolean = false,
	) {
		this._name = name;
	}

	protected abstract get issueLinkPattern(): string;

	get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		return [
			{
				url: this.issueLinkPattern,
				prefix: '',
				title: `Open Issue #<num> on ${this.name}`,
				referenceType: 'branch',
				alphanumeric: false,
				ignoreCase: true,
			},
		];
	}

	get avatarUri(): Uri | undefined {
		return undefined;
	}

	get displayPath(): string {
		return this.path;
	}

	get icon(): string {
		return 'remote';
	}

	get owner(): string | undefined {
		return this.splitPath(this.path)[0];
	}

	@memoize()
	get remoteKey(): string {
		return this.domain ? `${this.domain}/${this.path}` : this.path;
	}

	get repoDesc(): T {
		return { owner: this.owner, name: this.repoName } as unknown as T;
	}

	get providerDesc():
		| {
				id: GkProviderId;
				repoDomain: string;
				repoName: string;
				repoOwnerDomain?: string;
		  }
		| undefined {
		if (this.gkProviderId == null || this.owner == null || this.repoName == null) return undefined;

		return { id: this.gkProviderId, repoDomain: this.owner, repoName: this.repoName };
	}

	get repoName(): string | undefined {
		return this.splitPath(this.path)[1];
	}

	abstract get id(): RemoteProviderId;
	abstract get gkProviderId(): GkProviderId | undefined;
	abstract get name(): string;
	get supportedFeatures(): RemoteProviderSupportedFeatures {
		return {};
	}

	async copy(resource: RemoteResource | RemoteResource[]): Promise<void> {
		const urls = await this.getUrlsFromResources(resource);
		if (!urls.length) return;

		await env.clipboard.writeText(urls.join('\n'));
	}

	abstract getLocalInfoFromRemoteUri(repo: Repository, uri: Uri): Promise<LocalInfoFromRemoteUriResult | undefined>;

	async open(resource: RemoteResource | RemoteResource[]): Promise<boolean | undefined> {
		const urls = await this.getUrlsFromResources(resource);
		if (!urls.length) return false;

		const results = await Promise.allSettled(urls.map(openUrl));
		return results.every(r => getSettledValue(r) === true);
	}

	url(resource: RemoteResource, source?: Source): Promise<string | undefined> | string | undefined {
		switch (resource.type) {
			case RemoteResourceType.Branch:
				return this.getUrlForBranch(resource.branch);
			case RemoteResourceType.Branches:
				return this.getUrlForBranches();
			case RemoteResourceType.Commit:
				return this.getUrlForCommit(resource.sha);
			case RemoteResourceType.Comparison:
				return this.getUrlForComparison(resource.base, resource.head, resource.notation ?? '...');
			case RemoteResourceType.CreatePullRequest:
				return this.getUrlForCreatePullRequest(resource, source);
			case RemoteResourceType.File:
				return this.getUrlForFile(
					resource.fileName,
					resource.branchOrTag != null ? resource.branchOrTag : undefined,
					undefined,
					resource.range,
				);
			case RemoteResourceType.Repo:
				return this.getUrlForRepository();
			case RemoteResourceType.Revision:
				return this.getUrlForFile(
					resource.fileName,
					resource.branchOrTag != null ? resource.branchOrTag : undefined,
					resource.sha != null ? resource.sha : undefined,
					resource.range,
				);
			// TODO@axosoft-ramint needs to be implemented to support remote urls for tags
			// case RemoteResourceType.Tag:
			// 	return this.getUrlForTag(resource.tag);
			default:
				return undefined;
		}
	}

	protected get baseUrl(): string {
		return this.getRepoBaseUrl(this.path);
	}

	protected getRepoBaseUrl(path: string): string {
		return `${this.protocol}://${this.domain}/${path}`;
	}

	protected formatName(name: string): string {
		if (this._name != null) {
			return this._name;
		}
		return `${name}${this.custom ? ` (${this.domain})` : ''}`;
	}

	protected splitPath(path: string): [string, string] {
		const index = path.indexOf('/');
		return [path.substring(0, index), path.substring(index + 1)];
	}

	protected abstract getUrlForBranch(branch: string): string;

	protected abstract getUrlForBranches(): string;

	protected abstract getUrlForCommit(sha: string): string;

	protected abstract getUrlForComparison(
		base: string,
		head: string,
		notation: GitRevisionRangeNotation,
	): string | undefined;

	async isReadyForForCrossForkPullRequestUrls(): Promise<boolean> {
		return Promise.resolve(true);
	}

	protected abstract getUrlForCreatePullRequest(
		resource: CreatePullRequestRemoteResource,
		source?: Source,
	): string | undefined | Promise<string | undefined>;

	protected abstract getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string;

	protected getUrlForRepository(): string {
		return this.baseUrl;
	}

	protected encodeUrl(url: string): string;
	protected encodeUrl(url: string | undefined): string | undefined;
	protected encodeUrl(url: string | undefined): string | undefined {
		return encodeUrl(url)?.replace(/#/g, '%23');
	}

	private async getUrlsFromResources(resource: RemoteResource | RemoteResource[]): Promise<string[]> {
		const urlPromises: (Promise<string | undefined> | string | undefined)[] = [];

		if (Array.isArray(resource)) {
			for (const r of resource) {
				urlPromises.push(this.url(r));
			}
		} else {
			urlPromises.push(this.url(resource));
		}
		const urls: string[] = (await Promise.allSettled(urlPromises))
			.map(r => getSettledValue(r))
			.filter(r => r != null);
		return urls;
	}
}
