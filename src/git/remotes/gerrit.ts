import type { Range, Uri } from 'vscode';
import type { AutolinkReference, DynamicAutolinkReference } from '../../autolinks/models/autolinks';
import type { CreatePullRequestRemoteResource } from '../models/remoteResource';
import type { Repository } from '../models/repository';
import type { GkProviderId } from '../models/repositoryIdentities';
import type { GitRevisionRangeNotation } from '../models/revision';
import { isSha } from '../utils/revision.utils';
import type { LocalInfoFromRemoteUriResult, RemoteProviderId } from './remoteProvider';
import { RemoteProvider } from './remoteProvider';

const fileRegex = /^\/([^/]+)\/\+(.+)$/i;
const rangeRegex = /^(\d+)$/;

export class GerritRemote extends RemoteProvider {
	constructor(
		domain: string,
		path: string,
		protocol?: string,
		name?: string,
		custom: boolean = false,
		trimPath: boolean = true,
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

		super(domain, path, protocol, name, custom);
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
		return undefined; // TODO@eamodio DRAFTS add this when supported by backend
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

	async getLocalInfoFromRemoteUri(repo: Repository, uri: Uri): Promise<LocalInfoFromRemoteUriResult | undefined> {
		if (uri.authority !== this.domain) return undefined;
		if (!uri.path.startsWith(`/${this.path}/`)) return undefined;

		let startLine;
		if (uri.fragment) {
			const match = rangeRegex.exec(uri.fragment);
			if (match != null) {
				const [, start] = match;
				if (start) {
					startLine = parseInt(start, 10);
				}
			}
		}

		const match = fileRegex.exec(uri.path);
		if (match == null) return undefined;

		const [, , path] = match;

		// Check for a permalink
		let maybeShortPermalink: LocalInfoFromRemoteUriResult | undefined = undefined;

		let index = path.indexOf('/', 1);
		if (index !== -1) {
			const sha = path.substring(1, index);
			if (isSha(sha) || sha === 'HEAD') {
				const uri = await repo.getAbsoluteOrBestRevisionUri(path.substring(index), sha);
				if (uri != null) return { uri: uri, repoPath: repo.path, rev: sha, startLine: startLine };
			} else if (isSha(sha, true)) {
				const uri = await repo.getAbsoluteOrBestRevisionUri(path.substring(index), sha);
				if (uri != null) {
					maybeShortPermalink = { uri: uri, repoPath: repo.path, rev: sha, startLine: startLine };
				}
			}
		}

		// Check for a link with branch (and deal with branch names with /)
		if (path.startsWith('/refs/heads/')) {
			const branchPath = path.substring('/refs/heads/'.length);

			let branch;
			const possibleBranches = new Map<string, string>();
			index = branchPath.length;
			do {
				index = branchPath.lastIndexOf('/', index - 1);
				branch = branchPath.substring(1, index);

				possibleBranches.set(branch, branchPath.substring(index));
			} while (index > 0);

			if (possibleBranches.size) {
				const { values: branches } = await repo.git.branches().getBranches({
					filter: b => b.remote && possibleBranches.has(b.getNameWithoutRemote()),
				});
				for (const branch of branches) {
					const ref = branch.getNameWithoutRemote();
					const path = possibleBranches.get(ref);
					if (path == null) continue;

					const uri = await repo.getAbsoluteOrBestRevisionUri(path.substring(index), ref);
					if (uri != null) return { uri: uri, repoPath: repo.path, rev: ref, startLine: startLine };
				}
			}

			return undefined;
		}

		// Check for a link with tag (and deal with tag names with /)
		if (path.startsWith('/refs/tags/')) {
			const tagPath = path.substring('/refs/tags/'.length);

			let tag;
			const possibleTags = new Map<string, string>();
			index = tagPath.length;
			do {
				index = tagPath.lastIndexOf('/', index - 1);
				tag = tagPath.substring(1, index);

				possibleTags.set(tag, tagPath.substring(index));
			} while (index > 0);

			if (possibleTags.size) {
				const { values: tags } = await repo.git.tags().getTags({
					filter: t => possibleTags.has(t.name),
				});
				for (const tag of tags) {
					const path = possibleTags.get(tag.name);
					if (path == null) continue;

					const uri = await repo.getAbsoluteOrBestRevisionUri(path.substring(index), tag.name);
					if (uri != null) return { uri: uri, repoPath: repo.path, rev: tag.name, startLine: startLine };
				}
			}

			return undefined;
		}

		return maybeShortPermalink;
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

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
		const line = range != null ? `#${range.start.line}` : '';

		if (sha) return `${this.encodeUrl(`${this.baseUrl}/+/${sha}/${fileName}`)}${line}`;
		if (branch) return `${this.encodeUrl(`${this.getUrlForBranch(branch)}/${fileName}`)}${line}`;
		return `${this.encodeUrl(`${this.baseUrl}/+/HEAD/${fileName}`)}${line}`;
	}
}
