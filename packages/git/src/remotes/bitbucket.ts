import type { Brand, Unbrand } from '@gitlens/utils/brand.js';
import type { Uri } from '@gitlens/utils/uri.js';
import type { RemoteProviderContext } from '../context.js';
import type { AutolinkReference, DynamicAutolinkReference } from '../models/autolink.js';
import type { LineRange } from '../models/lineRange.js';
import type { ParsedRemoteFileUri, RemoteProviderId } from '../models/remoteProvider.js';
import { parseRefCandidates, RemoteProvider } from '../models/remoteProvider.js';
import type { CreatePullRequestRemoteResource } from '../models/remoteResource.js';
import type { GkProviderId } from '../models/repositoryIdentities.js';
import type { GitRevisionRangeNotation } from '../models/revision.js';

export class BitbucketRemoteProvider extends RemoteProvider {
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

	private static readonly fileRegex = /^\/([^/]+)\/([^/]+?)\/src(.+)$/i;
	private static readonly rangeRegex = /^lines-(\d+)(?::(\d+))?$/;

	override parseRemoteFileUri(uri: Uri): ParsedRemoteFileUri | undefined {
		if (uri.authority !== this.domain) return undefined;
		if (!uri.path.startsWith(`/${this.path}/`)) return undefined;

		let startLine;
		let endLine;
		if (uri.fragment) {
			const match = BitbucketRemoteProvider.rangeRegex.exec(uri.fragment);
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

		const match = BitbucketRemoteProvider.fileRegex.exec(uri.path);
		if (match == null) return undefined;

		const [, , , path] = match;

		return parseRefCandidates(path, startLine, endLine);
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
		const query = new URLSearchParams({
			source: head.branch,
			dest: `${this.owner ?? ''}/${this.repoName ?? ''}::${base.branch ?? ''}`,
		});
		return `${this.encodeUrl(`${this.getRepoBaseUrl(head.remote.path)}/pull-requests/new`)}?${query.toString()}`;
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: LineRange): string {
		let line;
		if (range != null) {
			if (range.startLine === range.endLine) {
				line = `#${fileName}-${range.startLine}`;
			} else {
				line = `#${fileName}-${range.startLine}:${range.endLine}`;
			}
		} else {
			line = '';
		}

		if (sha) return `${this.encodeUrl(`${this.baseUrl}/src/${sha}/${fileName}`)}${line}`;
		if (branch) return `${this.encodeUrl(`${this.baseUrl}/src/${branch}/${fileName}`)}${line}`;
		return `${this.encodeUrl(`${this.baseUrl}?path=${fileName}`)}${line}`;
	}
}
