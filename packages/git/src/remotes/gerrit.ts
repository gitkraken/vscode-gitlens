import type { Uri } from '@gitlens/utils/uri.js';
import type { RemoteProviderContext } from '../context.js';
import type { AutolinkReference, DynamicAutolinkReference } from '../models/autolink.js';
import type { LineRange } from '../models/lineRange.js';
import type { ParsedRemoteFileCandidate, ParsedRemoteFileUri, RemoteProviderId } from '../models/remoteProvider.js';
import { RemoteProvider } from '../models/remoteProvider.js';
import type { CreatePullRequestRemoteResource } from '../models/remoteResource.js';
import type { GkProviderId } from '../models/repositoryIdentities.js';
import type { GitRevisionRangeNotation } from '../models/revision.js';
import { isSha } from '../utils/revision.utils.js';

export class GerritRemoteProvider extends RemoteProvider {
	constructor(
		domain: string,
		path: string,
		protocol?: string,
		name?: string,
		custom: boolean = false,
		trimPath: boolean = true,
		context?: RemoteProviderContext,
	) {
		/*
		 * Git remote URLs differs when cloned by HTTPS with or without authentication.
		 * An anonymous clone looks like:
		 * 	 $ git clone "https://review.gerrithub.io/jenkinsci/gerrit-code-review-plugin"
		 * An authenticated clone looks like:
		 * 	 $ git clone "https://felipecrs@review.gerrithub.io/a/jenkinsci/gerrit-code-review-plugin"
		 *   Where username may be omitted, but the "a/" prefix is always present.
		 */
		if (trimPath && protocol !== 'ssh') {
			path = path.replace(/^a\//, '');
		}

		super(domain, path, protocol, name, custom, context);
	}

	protected override get issueLinkPattern(): string {
		return `${this.baseReviewUrl}/q/<num>`;
	}

	private _autolinks: (AutolinkReference | DynamicAutolinkReference)[] | undefined;
	override get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		if (this._autolinks === undefined) {
			this._autolinks = [
				...super.autolinks,
				{
					prefix: 'Change-Id: ',
					url: this.issueLinkPattern,
					alphanumeric: true,
					ignoreCase: true,
					title: `Open Change #<num> on ${this.name}`,

					description: `${this.name} Change #<num>`,
				},
			];
		}
		return this._autolinks;
	}

	override get icon(): string {
		return 'gerrit';
	}

	get id(): RemoteProviderId {
		return 'gerrit';
	}

	get gkProviderId(): GkProviderId | undefined {
		return undefined;
	}

	get name(): string {
		return this.formatName('Gerrit');
	}

	protected override get baseUrl(): string {
		return `${this.protocol}://${this.domain}/plugins/gitiles/${this.path}`;
	}

	protected get baseReviewUrl(): string {
		return `${this.protocol}://${this.domain}`;
	}

	private static readonly fileRegex = /^\/([^/]+)\/\+(.+)$/i;
	private static readonly rangeRegex = /^(\d+)$/;

	override parseRemoteFileUri(uri: Uri): ParsedRemoteFileUri | undefined {
		if (uri.authority !== this.domain) return undefined;
		if (!uri.path.startsWith(`/${this.path}/`)) return undefined;

		let startLine;
		if (uri.fragment) {
			const rangeMatch = GerritRemoteProvider.rangeRegex.exec(uri.fragment);
			if (rangeMatch != null) {
				const [, start] = rangeMatch;
				if (start) {
					startLine = parseInt(start, 10);
				}
			}
		}

		const fileMatch = GerritRemoteProvider.fileRegex.exec(uri.path);
		if (fileMatch == null) return undefined;

		const [, , path] = fileMatch;
		const candidates: ParsedRemoteFileCandidate[] = [];

		// Check for a permalink (SHA or HEAD)
		let index = path.indexOf('/', 1);
		if (index !== -1) {
			const ref = path.substring(1, index);
			if (isSha(ref) || ref === 'HEAD') {
				candidates.push({ type: 'sha', filePath: path.substring(index), rev: ref });
			} else if (isSha(ref, true)) {
				candidates.push({ type: 'shortSha', filePath: path.substring(index), rev: ref });
			}
		}

		// Check for a link with branch: /refs/heads/{branch}/{filePath}
		if (path.startsWith('/refs/heads/')) {
			const branchPath = path.substring('/refs/heads/'.length);
			const possibleBranches = new Map<string, string>();
			index = branchPath.length;
			do {
				index = branchPath.lastIndexOf('/', index - 1);
				const branch = branchPath.substring(1, index);
				possibleBranches.set(branch, branchPath.substring(index));
			} while (index > 0);

			if (possibleBranches.size !== 0) {
				candidates.push({ type: 'branches', possibleBranches: possibleBranches });
			}
		}

		// Check for a link with tag: /refs/tags/{tag}/{filePath}
		if (path.startsWith('/refs/tags/')) {
			const tagPath = path.substring('/refs/tags/'.length);
			const possibleTags = new Map<string, string>();
			index = tagPath.length;
			do {
				index = tagPath.lastIndexOf('/', index - 1);
				const tag = tagPath.substring(1, index);
				possibleTags.set(tag, tagPath.substring(index));
			} while (index > 0);

			if (possibleTags.size !== 0) {
				candidates.push({ type: 'tags', possibleTags: possibleTags });
			}
		}

		if (candidates.length === 0) return undefined;
		return { startLine: startLine, candidates: candidates };
	}

	protected getUrlForBranches(): string {
		return this.encodeUrl(`${this.baseReviewUrl}/admin/repos/${this.path},branches`);
	}

	protected getUrlForBranch(branch: string): string {
		return this.encodeUrl(`${this.baseUrl}/+/refs/heads/${branch}`);
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(`${this.baseReviewUrl}/q/${sha}`);
	}

	protected override getUrlForComparison(
		base: string,
		head: string,
		notation: GitRevisionRangeNotation,
	): string | undefined {
		return this.encodeUrl(`${this.baseReviewUrl}/q/${base}${notation}${head}`);
	}

	protected override getUrlForCreatePullRequest({ base, head }: CreatePullRequestRemoteResource): string | undefined {
		const query = new URLSearchParams({ sourceBranch: head.branch, targetBranch: base.branch ?? '' });

		return this.encodeUrl(`${this.baseReviewUrl}/createPullRequest?${query.toString()}`);
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: LineRange): string {
		const line = range != null ? `#${range.startLine}` : '';

		if (sha) return `${this.encodeUrl(`${this.baseUrl}/+/${sha}/${fileName}`)}${line}`;
		if (branch) return `${this.encodeUrl(`${this.getUrlForBranch(branch)}/${fileName}`)}${line}`;
		return `${this.encodeUrl(`${this.baseUrl}/+/HEAD/${fileName}`)}${line}`;
	}
}
