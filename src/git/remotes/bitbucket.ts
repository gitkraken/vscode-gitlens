import type { Range, Uri } from 'vscode';
import type { AutolinkReference, DynamicAutolinkReference } from '../../autolinks/models/autolinks';
import type { RepositoryDescriptor } from '../../plus/integrations/integration';
import type { Brand, Unbrand } from '../../system/brand';
import type { CreatePullRequestRemoteResource } from '../models/remoteResource';
import type { Repository } from '../models/repository';
import type { GkProviderId } from '../models/repositoryIdentities';
import type { GitRevisionRangeNotation } from '../models/revision';
import { isSha } from '../utils/revision.utils';
import type { LocalInfoFromRemoteUriResult, RemoteProviderId } from './remoteProvider';
import { RemoteProvider } from './remoteProvider';

const fileRegex = /^\/([^/]+)\/([^/]+?)\/src(.+)$/i;
const rangeRegex = /^lines-(\d+)(?::(\d+))?$/;

export class BitbucketRemote extends RemoteProvider<RepositoryDescriptor> {
	constructor(domain: string, path: string, protocol?: string, name?: string, custom: boolean = false) {
		super(domain, path, protocol, name, custom);
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

	override get icon(): string {
		return 'bitbucket';
	}

	get id(): RemoteProviderId {
		return 'bitbucket';
	}

	get gkProviderId(): GkProviderId {
		return 'bitbucket' satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
	}

	get name(): string {
		return this.formatName('Bitbucket');
	}

	async getLocalInfoFromRemoteUri(repo: Repository, uri: Uri): Promise<LocalInfoFromRemoteUriResult | undefined> {
		if (uri.authority !== this.domain) return undefined;
		if (!uri.path.startsWith(`/${this.path}/`)) return undefined;

		let startLine;
		let endLine;
		if (uri.fragment) {
			const match = rangeRegex.exec(uri.fragment);
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

		const match = fileRegex.exec(uri.path);
		if (match == null) return undefined;

		const [, , , path] = match;

		// Check for a permalink
		let maybeShortPermalink: LocalInfoFromRemoteUriResult | undefined = undefined;

		let index = path.indexOf('/', 1);
		if (index !== -1) {
			const sha = path.substring(1, index);
			if (isSha(sha)) {
				const uri = await repo.getAbsoluteOrBestRevisionUri(path.substring(index), sha);
				if (uri != null) {
					return { uri: uri, repoPath: repo.path, rev: sha, startLine: startLine, endLine: endLine };
				}
			} else if (isSha(sha, true)) {
				const uri = await repo.getAbsoluteOrBestRevisionUri(path.substring(index), sha);
				if (uri != null) {
					maybeShortPermalink = {
						uri: uri,
						repoPath: repo.path,
						rev: sha,
						startLine: startLine,
						endLine: endLine,
					};
				}
			}
		}

		// Check for a link with branch (and deal with branch names with /)
		let branch;
		const possibleBranches = new Map<string, string>();
		index = path.length;
		do {
			index = path.lastIndexOf('/', index - 1);
			branch = path.substring(1, index);

			possibleBranches.set(branch, path.substring(index));
		} while (index > 0);

		if (possibleBranches.size !== 0) {
			const { values: branches } = await repo.git.branches().getBranches({
				filter: b => b.remote && possibleBranches.has(b.getNameWithoutRemote()),
			});
			for (const branch of branches) {
				const ref = branch.getNameWithoutRemote();
				const path = possibleBranches.get(ref);
				if (path == null) continue;

				const uri = await repo.getAbsoluteOrBestRevisionUri(path.substring(index), ref);
				if (uri != null) {
					return { uri: uri, repoPath: repo.path, rev: ref, startLine: startLine, endLine: endLine };
				}
			}
		}

		return maybeShortPermalink;
	}

	protected getUrlForBranches(): string {
		return this.encodeUrl(`${this.baseUrl}/branches`);
	}

	protected getUrlForBranch(branch: string): string {
		return this.encodeUrl(`${this.baseUrl}/branch/${branch}`);
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(`${this.baseUrl}/commits/${sha}`);
	}

	protected override getUrlForComparison(base: string, head: string, _notation: GitRevisionRangeNotation): string {
		return `${this.encodeUrl(`${this.baseUrl}/branches/compare/${head}\r${base}`)}#diff`;
	}

	protected override getUrlForCreatePullRequest({ base, head }: CreatePullRequestRemoteResource): string | undefined {
		const { owner, name } = this.repoDesc;
		const query = new URLSearchParams({ source: head.branch, dest: `${owner}/${name}::${base.branch ?? ''}` });
		return `${this.encodeUrl(`${this.getRepoBaseUrl(head.remote.path)}/pull-requests/new`)}?${query.toString()}`;
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
		let line;
		if (range != null) {
			if (range.start.line === range.end.line) {
				line = `#${fileName}-${range.start.line}`;
			} else {
				line = `#${fileName}-${range.start.line}:${range.end.line}`;
			}
		} else {
			line = '';
		}

		if (sha) return `${this.encodeUrl(`${this.baseUrl}/src/${sha}/${fileName}`)}${line}`;
		if (branch) return `${this.encodeUrl(`${this.baseUrl}/src/${branch}/${fileName}`)}${line}`;
		return `${this.encodeUrl(`${this.baseUrl}?path=${fileName}`)}${line}`;
	}
}
