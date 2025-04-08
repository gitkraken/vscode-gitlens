import type { Range, Uri } from 'vscode';
import type { AutolinkReference, DynamicAutolinkReference } from '../../autolinks/models/autolinks';
import type { Source } from '../../constants.telemetry';
import type { Container } from '../../container';
import type { CreatePullRequestRemoteResource } from '../models/remoteResource';
import type { Repository } from '../models/repository';
import type { GkProviderId } from '../models/repositoryIdentities';
import type { GitRevisionRangeNotation } from '../models/revision';
import { describePullRequestWithAI } from '../utils/-webview/pullRequest.utils';
import { isSha } from '../utils/revision.utils';
import type { LocalInfoFromRemoteUriResult, RemoteProviderId, RemoteProviderSupportedFeatures } from './remoteProvider';
import { RemoteProvider } from './remoteProvider';

const fileRegex = /^\/([^/]+)\/([^/]+?)\/src(.+)$/i;
const rangeRegex = /^L(\d+)(?:-L(\d+))?$/;

export class GiteaRemote extends RemoteProvider {
	constructor(
		private readonly container: Container,
		domain: string,
		path: string,
		protocol?: string,
		name?: string,
		custom: boolean = false,
	) {
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
		return undefined; // TODO@eamodio DRAFTS add this when supported by backend
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
		let offset;
		let index;

		// Check for a permalink
		if (path.startsWith('/commit/')) {
			offset = '/commit/'.length;
			index = path.indexOf('/', offset);
			if (index !== -1) {
				const sha = path.substring(offset, index);
				if (isSha(sha, true)) {
					const uri = await repo.getAbsoluteOrBestRevisionUri(path.substring(index), sha);
					if (uri != null) {
						return { uri: uri, repoPath: repo.path, rev: sha, startLine: startLine, endLine: endLine };
					}
				}
			}
		}

		// Check for a link with branch (and deal with branch names with /)
		if (path.startsWith('/branch/')) {
			let branch;
			const possibleBranches = new Map<string, string>();
			offset = '/branch/'.length;
			index = offset;
			do {
				branch = path.substring(offset, index);
				possibleBranches.set(branch, path.substring(index));

				index = path.indexOf('/', index + 1);
			} while (index < path.length && index !== -1);

			if (possibleBranches.size) {
				const { values: branches } = await repo.git.branches().getBranches({
					filter: b => b.remote && possibleBranches.has(b.getNameWithoutRemote()),
				});
				for (const branch of branches) {
					const ref = branch.getNameWithoutRemote();
					const path = possibleBranches.get(ref);
					if (path == null) continue;

					const uri = await repo.getAbsoluteOrBestRevisionUri(path, ref);
					if (uri != null) {
						return {
							uri: uri,
							repoPath: repo.path,
							rev: ref,
							startLine: startLine,
							endLine: endLine,
						};
					}
				}
			}
		}

		return undefined;
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

	protected override async getUrlForCreatePullRequest(
		resource: CreatePullRequestRemoteResource,
		source?: Source,
	): Promise<string | undefined> {
		let { base, head, details } = resource;

		if (details?.describeWithAI) {
			details = await describePullRequestWithAI(
				this.container,
				resource.repoPath,
				resource,
				source ?? { source: 'ai' },
			);
		}

		const query = new URLSearchParams({ head: head.branch, base: base.branch ?? '' });
		if (details?.title) {
			query.set('title', details.title);
		}
		if (details?.description) {
			query.set('body', details.description);
		}
		return `${this.encodeUrl(`${this.baseUrl}/pulls/new`)}?${query.toString()}`;
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
		let line;
		if (range != null) {
			if (range.start.line === range.end.line) {
				line = `#L${range.start.line}`;
			} else {
				line = `#L${range.start.line}-L${range.end.line}`;
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
