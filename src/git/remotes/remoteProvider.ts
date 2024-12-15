import type { Range, Uri } from 'vscode';
import { env } from 'vscode';
import type { AutolinkReference, DynamicAutolinkReference } from '../../autolinks';
import type { GkProviderId } from '../../gk/models/repositoryIdentities';
import type { ResourceDescriptor } from '../../plus/integrations/integration';
import { memoize } from '../../system/decorators/memoize';
import { encodeUrl } from '../../system/encoding';
import { getSettledValue } from '../../system/promise';
import { openUrl } from '../../system/vscode/utils';
import type { ProviderReference } from '../models/remoteProvider';
import type { RemoteResource } from '../models/remoteResource';
import { RemoteResourceType } from '../models/remoteResource';
import type { Repository } from '../models/repository';

export type RemoteProviderId =
	| 'azure-devops'
	| 'bitbucket'
	| 'bitbucket-server'
	| 'custom'
	| 'gerrit'
	| 'gitea'
	| 'github'
	| 'gitlab'
	| 'google-source';

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
		return this.splitPath()[0];
	}

	@memoize()
	get remoteKey() {
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
		return this.splitPath()[1];
	}

	abstract get id(): RemoteProviderId;
	abstract get gkProviderId(): GkProviderId | undefined;
	abstract get name(): string;

	async copy(resource: RemoteResource | RemoteResource[]): Promise<void> {
		const urls = this.getUrlsFromResources(resource);
		if (!urls.length) return;

		await env.clipboard.writeText(urls.join('\n'));
	}

	abstract getLocalInfoFromRemoteUri(
		repository: Repository,
		uri: Uri,
		options?: { validate?: boolean },
	): Promise<{ uri: Uri; startLine?: number; endLine?: number } | undefined>;

	async open(resource: RemoteResource | RemoteResource[]): Promise<boolean | undefined> {
		const urls = this.getUrlsFromResources(resource);
		if (!urls.length) return false;

		const results = await Promise.allSettled(urls.map(openUrl));
		return results.every(r => getSettledValue(r) === true);
	}

	url(resource: RemoteResource): string | undefined {
		switch (resource.type) {
			case RemoteResourceType.Branch:
				return this.getUrlForBranch(resource.branch);
			case RemoteResourceType.Branches:
				return this.getUrlForBranches();
			case RemoteResourceType.Commit:
				return this.getUrlForCommit(resource.sha);
			case RemoteResourceType.Comparison: {
				return this.getUrlForComparison?.(resource.base, resource.compare, resource.notation ?? '...');
			}
			case RemoteResourceType.CreatePullRequest: {
				return this.getUrlForCreatePullRequest?.(resource.base, resource.compare);
			}
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
		return `${this.protocol}://${this.domain}/${this.path}`;
	}

	protected formatName(name: string) {
		if (this._name != null) {
			return this._name;
		}
		return `${name}${this.custom ? ` (${this.domain})` : ''}`;
	}

	protected splitPath(): [string, string] {
		const index = this.path.indexOf('/');
		return [this.path.substring(0, index), this.path.substring(index + 1)];
	}

	protected abstract getUrlForBranch(branch: string): string;

	protected abstract getUrlForBranches(): string;

	protected abstract getUrlForCommit(sha: string): string;

	protected getUrlForComparison?(base: string, compare: string, notation: '..' | '...'): string | undefined;

	protected getUrlForCreatePullRequest?(
		base: { branch?: string; remote: { path: string; url: string } },
		compare: { branch: string; remote: { path: string; url: string } },
	): string | undefined;

	protected abstract getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string;

	protected getUrlForRepository(): string {
		return this.baseUrl;
	}

	protected encodeUrl(url: string): string;
	protected encodeUrl(url: string | undefined): string | undefined;
	protected encodeUrl(url: string | undefined): string | undefined {
		return encodeUrl(url)?.replace(/#/g, '%23');
	}

	private getUrlsFromResources(resource: RemoteResource | RemoteResource[]): string[] {
		const urls: string[] = [];

		if (Array.isArray(resource)) {
			for (const r of resource) {
				const url = this.url(r);
				if (url == null) continue;

				urls.push(url);
			}
		} else {
			const url = this.url(resource);
			if (url != null) {
				urls.push(url);
			}
		}
		return urls;
	}
}
