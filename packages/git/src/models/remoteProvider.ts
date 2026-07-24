import { memoize } from '@gitlens/utils/decorators/memoize.js';
import { encodeUrl } from '@gitlens/utils/encoding.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { RemoteProviderContext } from '../context.js';
import { isSha } from '../utils/revision.utils.js';
import type { AutolinkReference, DynamicAutolinkReference } from './autolink.js';
import type { LineRange } from './lineRange.js';
import type { CreatePullRequestRemoteResource, RemoteResource } from './remoteResource.js';
import { RemoteResourceType } from './remoteResource.js';
import type { GkProviderId } from './repositoryIdentities.js';
import type { ResourceDescriptor } from './resourceDescriptor.js';
import type { GitRevisionRangeNotation } from './revision.js';

export interface ProviderReference {
	readonly id: string;
	readonly name: string;
	readonly domain: string;
	readonly icon: string;
}

export interface Provider extends ProviderReference {
	getIgnoreSSLErrors(): boolean | 'force';
	reauthenticate(): Promise<void>;
	trackRequestException(): void;
}

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

export interface RemoteProviderSupportedFeatures {
	createPullRequestWithDetails?: boolean;
}

/** A function that matches a remote URL to a remote provider instance */
export type RemoteProviderMatcher = (
	url: string,
	domain: string,
	path: string,
	scheme: string | undefined,
) => RemoteProvider | undefined;

export interface ParsedRemoteFileUri {
	startLine?: number;
	endLine?: number;
	candidates: ParsedRemoteFileCandidate[];
}

export type ParsedRemoteFileCandidate =
	| { readonly type: 'sha'; readonly filePath: string; readonly rev: string }
	| { readonly type: 'shortSha'; readonly filePath: string; readonly rev: string }
	| { readonly type: 'branches'; readonly possibleBranches: ReadonlyMap<string, string> }
	| { readonly type: 'tags'; readonly possibleTags: ReadonlyMap<string, string> }
	| { readonly type: 'pathOnly'; readonly filePath: string };

export interface RemotesUrlsConfig {
	readonly repository: string;
	readonly branches: string;
	readonly branch: string;
	readonly commit: string;
	readonly comparison?: string;
	readonly createPullRequest?: string;
	readonly file: string;
	readonly fileInBranch: string;
	readonly fileInCommit: string;
	readonly fileLine: string;
	readonly fileRange: string;
	readonly avatar?: string;
}

export abstract class RemoteProvider<T extends ResourceDescriptor = ResourceDescriptor> implements ProviderReference {
	protected readonly _name: string | undefined;

	protected readonly context: RemoteProviderContext | undefined;

	constructor(
		public readonly domain: string,
		public readonly path: string,
		public readonly protocol: string = 'https',
		name?: string,
		public readonly custom: boolean = false,
		context?: RemoteProviderContext,
	) {
		this._name = name;
		this.context = context;
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

	url(resource: RemoteResource): Promise<string | undefined> | string | undefined {
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
				return this.getUrlForCreatePullRequest(resource);
			case RemoteResourceType.File:
				return this.getUrlForFile(
					resource.fileName,
					resource.branchOrTag ?? undefined,
					undefined,
					resource.range,
				);
			case RemoteResourceType.Repo:
				return this.getUrlForRepository();
			case RemoteResourceType.Revision:
				return this.getUrlForFile(
					resource.fileName,
					resource.branchOrTag ?? undefined,
					resource.sha ?? undefined,
					resource.range,
				);
			// TODO@axosoft-ramint needs to be implemented to support remote urls for tags
			// case RemoteResourceType.Tag:
			// 	return this.getUrlForTag(resource.tag);
			default:
				return undefined;
		}
	}

	parseRemoteFileUri?(_uri: Uri): ParsedRemoteFileUri | undefined;

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

	protected abstract getUrlForCreatePullRequest(
		resource: CreatePullRequestRemoteResource,
	): string | undefined | Promise<string | undefined>;

	protected abstract getUrlForFile(fileName: string, branch?: string, sha?: string, range?: LineRange): string;

	protected getUrlForRepository(): string {
		return this.baseUrl;
	}

	protected encodeUrl(url: string): string;
	protected encodeUrl(url: string | undefined): string | undefined;
	protected encodeUrl(url: string | undefined): string | undefined {
		return encodeUrl(url)?.replace(/#/g, '%23');
	}
}

/**
 * Parses a URL path segment like `/{ref}/{filePath}` into candidate ref interpretations
 * (SHA, short SHA, or possible branch names). Used by GitHub, GitLab, Bitbucket, and
 * Bitbucket Server where the URL structure is `/{owner}/{repo}/{type}/{ref}/{filePath}`
 * and the ref can be a SHA or branch name (which may contain `/`).
 */
export function parseRefCandidates(
	path: string,
	startLine?: number,
	endLine?: number,
): ParsedRemoteFileUri | undefined {
	const candidates: ParsedRemoteFileCandidate[] = [];

	const index = path.indexOf('/', 1);
	if (index !== -1) {
		const ref = path.substring(1, index);
		const filePath = path.substring(index);

		if (isSha(ref)) {
			candidates.push({ type: 'sha', filePath: filePath, rev: ref });
		} else if (isSha(ref, true)) {
			candidates.push({ type: 'shortSha', filePath: filePath, rev: ref });
		}
	}

	// Enumerate possible branches (handle branch names with /)
	const possibleBranches = new Map<string, string>();
	let branchIndex = path.length;
	while (true) {
		branchIndex = path.lastIndexOf('/', branchIndex - 1);
		if (branchIndex <= 0) break;

		const branch = path.substring(1, branchIndex);
		possibleBranches.set(branch, path.substring(branchIndex));
	}

	if (possibleBranches.size) {
		candidates.push({ type: 'branches', possibleBranches: possibleBranches });
	}

	if (candidates.length === 0) return undefined;

	return { startLine: startLine, endLine: endLine, candidates: candidates };
}
