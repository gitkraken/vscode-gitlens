import type { Uri } from '@gitlens/utils/uri.js';
import type { RemoteProviderContext } from '../context.js';
import type { AutolinkReference, DynamicAutolinkReference } from '../models/autolink.js';
import type { LineRange } from '../models/lineRange.js';
import type {
	ParsedRemoteFileCandidate,
	ParsedRemoteFileUri,
	RemoteProviderId,
	RemoteProviderSupportedFeatures,
} from '../models/remoteProvider.js';
import { RemoteProvider } from '../models/remoteProvider.js';
import type { CreatePullRequestRemoteResource } from '../models/remoteResource.js';
import type { GkProviderId } from '../models/repositoryIdentities.js';
import type { GitRevisionRangeNotation } from '../models/revision.js';
import { isSha } from '../utils/revision.utils.js';

export class GiteaRemoteProvider extends RemoteProvider {
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
					prefix: '#',
					url: this.issueLinkPattern,
					alphanumeric: false,
					ignoreCase: false,
					title: `Open Issue #<num> on ${this.name}`,

					type: 'issue',
					description: `${this.name} Issue #<num>`,
				},
			];
		}
		return this._autolinks;
	}

	override get icon(): string {
		return 'gitea';
	}

	get id(): RemoteProviderId {
		return 'gitea';
	}

	get gkProviderId(): GkProviderId | undefined {
		return undefined;
	}

	get name(): string {
		return this.formatName('Gitea');
	}

	override get supportedFeatures(): RemoteProviderSupportedFeatures {
		return {
			...super.supportedFeatures,
			createPullRequestWithDetails: true,
		};
	}

	private static readonly fileRegex = /^\/([^/]+)\/([^/]+?)\/src(.+)$/i;
	private static readonly rangeRegex = /^L(\d+)(?:-L(\d+))?$/;

	override parseRemoteFileUri(uri: Uri): ParsedRemoteFileUri | undefined {
		if (uri.authority !== this.domain) return undefined;
		if (!uri.path.startsWith(`/${this.path}/`)) return undefined;

		let startLine;
		let endLine;
		if (uri.fragment) {
			const match = GiteaRemoteProvider.rangeRegex.exec(uri.fragment);
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

		const match = GiteaRemoteProvider.fileRegex.exec(uri.path);
		if (match == null) return undefined;

		const [, , , path] = match;
		const candidates: ParsedRemoteFileCandidate[] = [];

		// Check for a permalink: /src/commit/{sha}/{filePath}
		if (path.startsWith('/commit/')) {
			const offset = '/commit/'.length;
			const index = path.indexOf('/', offset);
			if (index !== -1) {
				const sha = path.substring(offset, index);
				if (isSha(sha)) {
					candidates.push({ type: 'sha', filePath: path.substring(index), rev: sha });
				} else if (isSha(sha, true)) {
					candidates.push({ type: 'shortSha', filePath: path.substring(index), rev: sha });
				}
			}
		}

		// Check for a link with branch: /src/branch/{name}/{filePath}
		if (path.startsWith('/branch/')) {
			const offset = '/branch/'.length;
			const possibleBranches = new Map<string, string>();
			let index = offset;
			do {
				const branch = path.substring(offset, index);
				possibleBranches.set(branch, path.substring(index));
				index = path.indexOf('/', index + 1);
			} while (index < path.length && index !== -1);

			if (possibleBranches.size !== 0) {
				candidates.push({ type: 'branches', possibleBranches: possibleBranches });
			}
		}

		if (candidates.length === 0) return undefined;
		return { startLine: startLine, endLine: endLine, candidates: candidates };
	}

	protected getUrlForBranches(): string {
		return this.encodeUrl(`${this.baseUrl}/branches`);
	}

	protected getUrlForBranch(branch: string): string {
		return this.encodeUrl(`${this.baseUrl}/src/branch/${branch}`);
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(`${this.baseUrl}/commit/${sha}`);
	}

	protected override getUrlForComparison(base: string, head: string, _notation: GitRevisionRangeNotation): string {
		return this.encodeUrl(`${this.baseUrl}/compare/${base}...${head}`);
	}

	protected override getUrlForCreatePullRequest(
		resource: CreatePullRequestRemoteResource,
	): string | undefined | Promise<string | undefined> {
		const { base, head, details } = resource;

		const query = new URLSearchParams({ head: head.branch, base: base.branch ?? '' });
		if (details && 'title' in details && details.title) {
			query.set('title', details.title);
		}
		if (details && 'description' in details && details.description) {
			query.set('body', details.description);
		}
		return `${this.encodeUrl(`${this.baseUrl}/pulls/new`)}?${query.toString()}`;
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

		if (sha) return `${this.encodeUrl(`${this.baseUrl}/src/commit/${sha}/${fileName}`)}${line}`;
		if (branch) return `${this.encodeUrl(`${this.baseUrl}/src/branch/${branch}/${fileName}`)}${line}`;
		// this route is deprecated but there is no alternative
		return `${this.encodeUrl(`${this.baseUrl}/src/${fileName}`)}${line}`;
	}
}
