import * as l10n from '@vscode/l10n';
import type { Brand, Unbrand } from '@gitlens/utils/brand.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { RemoteProviderContext } from '../context.js';
import type { AutolinkReference, DynamicAutolinkReference } from '../models/autolink.js';
import type { LineRange } from '../models/lineRange.js';
import type { ParsedRemoteFileUri, RemoteProviderId } from '../models/remoteProvider.js';
import { RemoteProvider } from '../models/remoteProvider.js';
import type { CreatePullRequestRemoteResource } from '../models/remoteResource.js';
import type { GkProviderId } from '../models/repositoryIdentities.js';
import type { ResourceDescriptor } from '../models/resourceDescriptor.js';
import type { GitRevisionRangeNotation } from '../models/revision.js';

const gitRegex = /\/_git\/?/i;
const gitTailRegex = /\/_git(?:\/.*)?$/i;
const edgeSlashesRegex = /^\/+|\/+$/g;
const leadingGitRegex = /^_git\//i;
const legacyDefaultCollectionRegex = /^DefaultCollection\//i;
const orgAndProjectRegex = /^(.*?)\/(.*?)\/(.*)/;
const sshDomainRegex = /^(ssh|vs-ssh)\./i;
const sshPathRegex = /^\/?v\d\//i;

const azureSshUrlRegex = /^(?:[^@]+@)?([^:]+):v\d\//;

const vstsHostnameSuffix = '.visualstudio.com';

export function isVsts(domain: string): boolean {
	return domain.toLowerCase().endsWith(vstsHostnameSuffix);
}

type AzureRepositoryPath = {
	collection: string | undefined;
	project: string;
	repository: string;
	repositoryPath: string;
	virtualDirectory: string | undefined;
};

export type AzureDevOpsRepositoryDescriptor = ResourceDescriptor & {
	owner: string | undefined;
	name: string | undefined;
	virtualDirectory?: string;
};

function parseAzureRepositoryPath(path: string, legacyVsts: boolean, cloud: boolean): AzureRepositoryPath | undefined {
	const segments = path.split('/').map(segment => decodeURIComponent(segment));
	const gitIndex = segments.length - 2;
	if (
		gitIndex < 0 ||
		segments[gitIndex]?.toLowerCase() !== '_git' ||
		segments.some(segment => !segment || segment === '.' || segment === '..' || /[/\\]/.test(segment))
	) {
		return undefined;
	}

	const repository = segments[gitIndex + 1];
	const prefix = segments.slice(0, gitIndex);

	let collection: string | undefined;
	let projectSegment: string | undefined;
	let virtualDirectory: string | undefined;
	if (legacyVsts) {
		// A VSTS-era clone URL may still name the service's only collection, which is the organization the host
		// already carries, so it never selects a project
		if (prefix[0]?.toLowerCase() === 'defaultcollection') {
			prefix.shift();
		}
		if (prefix.length > 1) return undefined;

		[projectSegment] = prefix;
	} else if (cloud) {
		if (prefix.length === 0 || prefix.length > 2) return undefined;

		[collection, projectSegment] = prefix;
	} else if (prefix.length === 1) {
		// A server path always names its collection, so a lone segment before `_git` is the collection, and the project
		// segment was left out (TFS 2018 reports that form as the clone URL of a repository named after its project)
		[collection] = prefix;
	} else {
		// With more segments the last two read as collection and project. A project-less path behind a virtual directory
		// (`{vdir}/{collection}/_git/{repo}`) reads the same way, which the URL can't tell apart; the Azure DevOps Server
		// integration settles it against the collections it discovers
		if (prefix.length === 0) return undefined;

		[collection, projectSegment] = prefix.slice(-2);
		if (prefix.length > 2) {
			virtualDirectory = prefix.slice(0, -2).join('/');
		}
	}

	// With no project segment (`{org}/_git/{repo}`), Azure names the repository after its project
	const project = projectSegment ?? repository;
	return {
		collection: collection,
		project: project,
		repository: repository,
		repositoryPath: `${project}/_git/${repository}`,
		virtualDirectory: virtualDirectory,
	};
}

function parseAzureHttpsRepository(url: URL): { owner: string; project: string; repo: string } | undefined {
	const vsts = isVsts(url.hostname);
	const parsed = parseAzureRepositoryPath(
		url.pathname.replace(edgeSlashesRegex, ''),
		vsts,
		url.hostname.toLowerCase() === 'dev.azure.com',
	);
	// VSTS carries the organization in the host rather than in the path
	const owner = vsts ? url.hostname.split('.')[0] : parsed?.collection;
	if (parsed == null || owner == null) return undefined;

	return { owner: owner, project: parsed.project, repo: parsed.repository };
}

export function parseAzureHttpsUrl(url: string): [owner: string, project: string, repo: string];
export function parseAzureHttpsUrl(urlObj: URL): [owner: string, project: string, repo: string];
export function parseAzureHttpsUrl(arg: URL | string): [owner: string, project: string, repo: string] {
	const url = typeof arg === 'string' ? new URL(arg) : arg;
	const parsed = parseAzureHttpsRepository(url);
	if (parsed == null) throw new Error(`Invalid Azure URL: ${url.toString()}`);

	return [parsed.owner, parsed.project, parsed.repo];
}

export class AzureDevOpsRemoteProvider extends RemoteProvider<AzureDevOpsRepositoryDescriptor> {
	private readonly collection: string | undefined;
	private readonly project: string | undefined;
	private readonly repositoryPath: string | undefined;
	private readonly virtualDirectory: string | undefined;

	constructor(
		domain: string,
		path: string,
		protocol?: string,
		name?: string,
		isVsts: boolean = false,
		context?: RemoteProviderContext,
	) {
		if (sshDomainRegex.test(domain)) {
			path = path.replace(sshPathRegex, '');
			domain = domain.replace(sshDomainRegex, '');

			// Add in /_git/ into ssh urls
			const match = orgAndProjectRegex.exec(path);
			if (match != null) {
				const [, org, project, rest] = match;

				// VSTS puts the org in the subdomain; modern Azure DevOps puts it in the path
				if (isVsts) {
					domain = `${org}.${domain}`;
					path = `${project}/_git/${rest}`;
				} else {
					path = `${org}/${project}/_git/${rest}`;
				}
			}
		}

		// Azure DevOps allows projects and repository names with spaces. In that situation,
		// the `path` will be previously encoded during git clone
		// revert that encoding to avoid double-encoding by gitlens during copy remote and open remote
		const repositoryPath = parseAzureRepositoryPath(path, isVsts, domain.toLowerCase() === 'dev.azure.com');
		path = decodeURIComponent(path);
		super(domain, path, protocol, name, undefined, context);
		this.collection = repositoryPath?.collection;
		this.project = repositoryPath?.project;
		this.repositoryPath = repositoryPath?.repositoryPath;
		this.virtualDirectory = repositoryPath?.virtualDirectory;
	}

	protected override get issueLinkPattern(): string {
		let orgUrl;
		if (this.repositoryPath != null) {
			// Work items live at the organization (collection) root: the host itself on VSTS, which is why a legacy
			// `DefaultCollection` segment and a project-less repository path need no special casing here
			const orgPath = [this.virtualDirectory, this.collection].filter(Boolean).join('/');
			orgUrl = `${this.protocol}://${this.domain}${orgPath ? `/${orgPath}` : ''}`;
		} else {
			const projectUrl = this.baseUrl.replace(gitTailRegex, '');
			orgUrl = projectUrl.substring(0, projectUrl.lastIndexOf('/'));
		}
		return `${orgUrl}/_workitems/edit/<num>`;
	}

	private _autolinks: (AutolinkReference | DynamicAutolinkReference)[] | undefined;
	override get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		// Strip off any `_git` part from the repo url
		this._autolinks ??= [
			...super.autolinks,
			{
				prefix: '#',
				url: this.issueLinkPattern,
				alphanumeric: false,
				ignoreCase: false,
				title: l10n.t('Open Work Item #{number} on {provider}', { number: '<num>', provider: this.name }),

				type: 'issue',
				description: l10n.t('{provider} Work Item #{number}', { provider: this.name, number: '<num>' }),
			},
			{
				// Default Pull request message when merging a PR in ADO. Will not catch commits & pushes following a different pattern.
				prefix: 'PR ',
				url: `${this.baseUrl}/pullrequest/<num>`,
				alphanumeric: false,
				ignoreCase: false,
				title: l10n.t('Open Pull Request #{number} on {provider}', { number: '<num>', provider: this.name }),

				type: 'pullrequest',
				description: l10n.t('{provider} Pull Request #{number}', {
					provider: this.name,
					number: '<num>',
				}),
			},
		];
		return this._autolinks;
	}

	override get icon(): string {
		return 'azdo';
	}

	get id(): RemoteProviderId {
		return 'azure-devops';
	}

	get gkProviderId(): GkProviderId {
		return 'azureDevops' satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
	}

	get name(): string {
		return 'Azure DevOps';
	}

	override get owner(): string | undefined {
		if (isVsts(this.domain)) {
			return this.domain.split('.')[0];
		}
		return this.collection ?? super.owner;
	}

	override get repoName(): string | undefined {
		return this.repositoryPath ?? (isVsts(this.domain) ? this.path : super.repoName);
	}

	override get repoDesc(): AzureDevOpsRepositoryDescriptor {
		const descriptor = super.repoDesc;
		return this.virtualDirectory == null ? descriptor : { ...descriptor, virtualDirectory: this.virtualDirectory };
	}

	override get providerDesc():
		| {
				id: GkProviderId;
				repoDomain: string;
				repoName: string;
				repoOwnerDomain: string;
		  }
		| undefined {
		if (this.gkProviderId == null || this.owner == null || this.repoName == null || this.project == null) {
			return undefined;
		}

		return {
			id: this.gkProviderId,
			repoDomain: this.project,
			repoName: this.repoName,
			repoOwnerDomain: this.owner,
		};
	}

	private _displayPath: string | undefined;
	override get displayPath(): string {
		this._displayPath ??= this.path
			.replace(leadingGitRegex, '')
			.replace(gitRegex, '/')
			.replace(legacyDefaultCollectionRegex, '');
		return this._displayPath;
	}

	private static readonly fileQueryRegex = /path=([^&]+)/i;
	private static readonly rangeQueryRegex = /line=(\d+)(?:&lineEnd=(\d+))?/;

	override parseRemoteFileUri(uri: Uri): ParsedRemoteFileUri | undefined {
		if (uri.authority !== this.domain) return undefined;

		let startLine;
		let endLine;
		if (uri.query) {
			const rangeMatch = AzureDevOpsRemoteProvider.rangeQueryRegex.exec(uri.query);
			if (rangeMatch != null) {
				const [, start, end] = rangeMatch;
				if (start) {
					startLine = parseInt(start, 10);
					if (end) {
						endLine = parseInt(end, 10);
					}
				}
			}
		}

		const fileMatch = AzureDevOpsRemoteProvider.fileQueryRegex.exec(uri.query);
		if (fileMatch == null) return undefined;

		const [, path] = fileMatch;

		return {
			startLine: startLine,
			endLine: endLine,
			candidates: [{ type: 'pathOnly', filePath: path }],
		};
	}

	protected getUrlForBranches(): string {
		return this.encodeUrl(`${this.baseUrl}/branches`);
	}

	protected getUrlForBranch(branch: string): string {
		return this.encodeUrl(`${this.baseUrl}/?version=GB${branch}&_a=history`);
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(`${this.baseUrl}/commit/${sha}`);
	}

	protected override getUrlForComparison(base: string, head: string, _notation: GitRevisionRangeNotation): string {
		return this.encodeUrl(`${this.baseUrl}/branchCompare?baseVersion=GB${base}&targetVersion=GB${head}`);
	}

	protected override async getUrlForCreatePullRequest({
		base,
		head,
	}: CreatePullRequestRemoteResource): Promise<string | undefined> {
		const query = new URLSearchParams({ sourceRef: head.branch, targetRef: base.branch ?? '' });

		if (base.remote.url !== head.remote.url) {
			const parsedBaseUrl = parseAzureUrl(base.remote.url);
			if (parsedBaseUrl == null) return undefined;

			const { org: baseOrg, project: baseProject, repo: baseName } = parsedBaseUrl;
			const repoInfo = await this.context?.getRepositoryInfo?.(this.id, {
				owner: baseOrg,
				name: baseName,
				project: baseProject,
			});
			if (!repoInfo) return undefined;

			query.set('targetRepositoryId', repoInfo.id);
		}

		return `${this.encodeUrl(`${this.getRepoBaseUrl(head.remote.path)}/pullrequestcreate`)}?${query.toString()}`;
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: LineRange): string {
		let line;
		if (range != null) {
			if (range.startLine === range.endLine) {
				line = `&line=${range.startLine}&lineStartColumn=${range.startCharacter}&lineEndColumn=${range.endCharacter}`;
			} else {
				line = `&line=${range.startLine}&lineEnd=${range.endLine}&lineStartColumn=${range.startCharacter}&lineEndColumn=${range.endCharacter}`;
			}
		} else {
			line = '';
		}

		if (sha) return this.encodeUrl(`${this.baseUrl}?path=${fileName}&version=GC${sha}${line}&_a=contents`);
		if (branch) return this.encodeUrl(`${this.baseUrl}/?path=/${fileName}&version=GB${branch}&_a=contents${line}`);
		return this.encodeUrl(`${this.baseUrl}?path=/${fileName}${line}`);
	}
}

function parseAzureUrl(url: string): { org: string; project: string; repo: string } | undefined {
	if (azureSshUrlRegex.test(url)) {
		// Examples of SSH urls:
		// - old one: bbbchiv@vs-ssh.visualstudio.com:v3/bbbchiv/MyFirstProject/test
		// - modern one: git@ssh.dev.azure.com:v3/bbbchiv2/MyFirstProject/test
		url = url.replace(azureSshUrlRegex, '');
		const match = orgAndProjectRegex.exec(url);
		if (match != null) {
			const [, org, project, rest] = match;
			return { org: org, project: project, repo: rest };
		}
	} else {
		let parsed;
		try {
			parsed = parseAzureHttpsRepository(new URL(url));
		} catch {
			return undefined;
		}
		return parsed != null ? { org: parsed.owner, project: parsed.project, repo: parsed.repo } : undefined;
	}
	return undefined;
}
