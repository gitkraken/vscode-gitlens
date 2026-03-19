import type { Brand, Unbrand } from '@gitlens/utils/brand.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { RemoteProviderContext } from '../context.js';
import type { AutolinkReference, DynamicAutolinkReference } from '../models/autolink.js';
import type { LineRange } from '../models/lineRange.js';
import type { ParsedRemoteFileUri, RemoteProviderId } from '../models/remoteProvider.js';
import { RemoteProvider } from '../models/remoteProvider.js';
import type { CreatePullRequestRemoteResource } from '../models/remoteResource.js';
import type { GkProviderId } from '../models/repositoryIdentities.js';
import type { GitRevisionRangeNotation } from '../models/revision.js';

const gitRegex = /\/_git\/?/i;
const gitTailRegex = /\/_git(?:\/.*)?$/i;
const legacyDefaultCollectionRegex = /^DefaultCollection\//i;
const orgAndProjectRegex = /^(.*?)\/(.*?)\/(.*)/;
const sshDomainRegex = /^(ssh|vs-ssh)\./i;
const sshPathRegex = /^\/?v\d\//i;

const azureSshUrlRegex = /^(?:[^@]+@)?([^:]+):v\d\//;

const vstsHostnameRegex = /\.visualstudio\.com$/;

export function isVsts(domain: string): boolean {
	return vstsHostnameRegex.test(domain);
}

function getVSTSOwner(url: URL): string {
	return url.hostname.split('.')[0];
}

const azureProjectRepoRegex = /([^/]+)\/_git\/([^/]+)/;

function parseVstsHttpsUrl(url: URL): [string, string, string] {
	const owner = getVSTSOwner(url);
	const match = azureProjectRepoRegex.exec(url.pathname);
	if (match == null) throw new Error(`Invalid VSTS URL: ${url.toString()}`);
	const [, project, repo] = match;
	return [owner, project, repo];
}

const azureHttpsUrlRegex2 = /([^/]+)\/([^/]+)\/_git\/([^/]+)/;

function parseAzureNewStyleUrl(url: URL): [string, string, string] {
	const match = azureHttpsUrlRegex2.exec(url.pathname);
	if (match == null) throw new Error(`Invalid Azure URL: ${url.toString()}`);
	const [, owner, project, repo] = match;
	return [owner, project, repo];
}

export function parseAzureHttpsUrl(url: string): [owner: string, project: string, repo: string];
export function parseAzureHttpsUrl(urlObj: URL): [owner: string, project: string, repo: string];
export function parseAzureHttpsUrl(arg: URL | string): [owner: string, project: string, repo: string] {
	const url = typeof arg === 'string' ? new URL(arg) : arg;
	if (vstsHostnameRegex.test(url.hostname)) return parseVstsHttpsUrl(url);
	return parseAzureNewStyleUrl(url);
}

export class AzureDevOpsRemoteProvider extends RemoteProvider {
	private readonly project: string | undefined;

	constructor(
		domain: string,
		path: string,
		protocol?: string,
		name?: string,
		isVsts: boolean = false,
		context?: RemoteProviderContext,
	) {
		let repoProject;
		if (sshDomainRegex.test(domain)) {
			path = path.replace(sshPathRegex, '');
			domain = domain.replace(sshDomainRegex, '');

			// Add in /_git/ into ssh urls
			const match = orgAndProjectRegex.exec(path);
			if (match != null) {
				const [, org, project, rest] = match;

				repoProject = project;

				// VSTS puts the org in the subdomain; modern Azure DevOps puts it in the path
				if (isVsts) {
					domain = `${org}.${domain}`;
					path = `${project}/_git/${rest}`;
				} else {
					path = `${org}/${project}/_git/${rest}`;
				}
			}
		} else {
			const match = orgAndProjectRegex.exec(path);
			if (match != null) {
				const [, , project] = match;

				repoProject = project;
			}
		}

		// Azure DevOps allows projects and repository names with spaces. In that situation,
		// the `path` will be previously encoded during git clone
		// revert that encoding to avoid double-encoding by gitlens during copy remote and open remote
		path = decodeURIComponent(path);
		super(domain, path, protocol, name, undefined, context);
		this.project = repoProject;
	}

	protected override get issueLinkPattern(): string {
		const projectUrl = this.baseUrl.replace(gitTailRegex, '');
		const orgUrl = projectUrl.substring(0, projectUrl.lastIndexOf('/'));
		return `${orgUrl}/_workitems/edit/<num>`;
	}

	private _autolinks: (AutolinkReference | DynamicAutolinkReference)[] | undefined;
	override get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		if (this._autolinks === undefined) {
			// Strip off any `_git` part from the repo url
			this._autolinks = [
				...super.autolinks,
				{
					prefix: '#',
					url: this.issueLinkPattern,
					alphanumeric: false,
					ignoreCase: false,
					title: `Open Work Item #<num> on ${this.name}`,

					type: 'issue',
					description: `${this.name} Work Item #<num>`,
				},
				{
					// Default Pull request message when merging a PR in ADO. Will not catch commits & pushes following a different pattern.
					prefix: 'PR ',
					url: `${this.baseUrl}/pullrequest/<num>`,
					alphanumeric: false,
					ignoreCase: false,
					title: `Open Pull Request #<num> on ${this.name}`,

					type: 'pullrequest',
					description: `${this.name} Pull Request #<num>`,
				},
			];
		}
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
		return super.owner;
	}

	override get repoName(): string | undefined {
		if (isVsts(this.domain)) {
			return this.path;
		}
		return super.repoName;
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
		if (this._displayPath === undefined) {
			this._displayPath = this.path.replace(gitRegex, '/').replace(legacyDefaultCollectionRegex, '');
		}
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
		const [org, project, rest] = parseAzureHttpsUrl(url);
		return { org: org, project: project, repo: rest };
	}
	return undefined;
}
