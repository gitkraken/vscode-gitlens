import type { Range, Uri } from 'vscode';
import type { AutolinkReference, DynamicAutolinkReference } from '../../autolinks/models/autolinks';
import type { Container } from '../../container';
import { HostingIntegration } from '../../plus/integrations/integration';
import { remoteProviderIdToIntegrationId } from '../../plus/integrations/integrationService';
import type { Brand, Unbrand } from '../../system/brand';
import type { Repository } from '../models/repository';
import type { GkProviderId } from '../models/repositoryIdentities';
import { isSha } from '../utils/revision.utils';
import type { RemoteProviderId } from './remoteProvider';
import { RemoteProvider } from './remoteProvider';

const fileRegex = /^\/([^/]+)\/([^/]+?)\/src(.+)$/i;
const rangeRegex = /^lines-(\d+)(?::(\d+))?$/;

export class BitbucketServerRemote extends RemoteProvider {
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
					alphanumeric: false,
					ignoreCase: true,
					url: `${this.baseUrl}/pull-requests/<num>`,
					title: `Open Pull Request #<num> on ${this.name}`,

					type: 'pullrequest',
					description: `${this.name} Pull Request #<num>`,
				},
			];
		}
		return this._autolinks;
	}

	protected override get baseUrl(): string {
		const [project, repo] = this.splitPath();
		return `${this.protocol}://${this.domain}/projects/${project}/repos/${repo}`;
	}

	protected override splitArgPath(argPath: string): [string, string] {
		if (argPath.startsWith('scm/') && argPath.indexOf('/') !== argPath.lastIndexOf('/')) {
			return super.splitArgPath(argPath.replace('scm/', ''));
		}

		return super.splitArgPath(argPath);
	}

	override get icon(): string {
		return 'bitbucket';
	}

	get id(): RemoteProviderId {
		return 'bitbucket-server';
	}

	get gkProviderId(): GkProviderId {
		return 'bitbucketServer' satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
	}

	get name(): string {
		return this.formatName('Bitbucket Server');
	}

	async getLocalInfoFromRemoteUri(
		repository: Repository,
		uri: Uri,
		options?: { validate?: boolean },
	): Promise<{ uri: Uri; startLine?: number; endLine?: number } | undefined> {
		if (uri.authority !== this.domain) return undefined;
		if ((options?.validate ?? true) && !uri.path.startsWith(`/${this.path}/`)) return undefined;

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
		let index = path.indexOf('/', 1);
		if (index !== -1) {
			const sha = path.substring(1, index);
			if (isSha(sha)) {
				const uri = repository.toAbsoluteUri(path.substring(index), { validate: options?.validate });
				if (uri != null) return { uri: uri, startLine: startLine, endLine: endLine };
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
			const { values: branches } = await repository.git.branches().getBranches({
				filter: b => b.remote && possibleBranches.has(b.getNameWithoutRemote()),
			});
			for (const branch of branches) {
				const path = possibleBranches.get(branch.getNameWithoutRemote());
				if (path == null) continue;

				const uri = repository.toAbsoluteUri(path, { validate: options?.validate });
				if (uri != null) return { uri: uri, startLine: startLine, endLine: endLine };
			}
		}

		return undefined;
	}

	protected getUrlForBranches(): string {
		return this.encodeUrl(`${this.baseUrl}/branches`);
	}

	protected getUrlForBranch(branch: string): string {
		return this.encodeUrl(`${this.baseUrl}/commits?until=${branch}`);
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(`${this.baseUrl}/commits/${sha}`);
	}

	protected override getUrlForComparison(base: string, head: string, _notation: '..' | '...'): string {
		return this.encodeUrl(`${this.baseUrl}/branches/compare/${head}\r${base}`);
	}

	override async isReadyForForCrossForkPullRequestUrls(): Promise<boolean> {
		const integrationId = remoteProviderIdToIntegrationId(this.id);
		const integration = integrationId && (await this.container.integrations.get(integrationId));
		return integration?.maybeConnected ?? integration?.isConnected() ?? false;
	}

	protected override async getUrlForCreatePullRequest(
		base: { branch?: string; remote: { path: string; url: string } },
		head: { branch: string; remote: { path: string; url: string } },
		options?: { title?: string; description?: string },
	): Promise<string | undefined> {
		const query = new URLSearchParams({ sourceBranch: head.branch, targetBranch: base.branch ?? '' });
		const [baseOwner, baseName] = this.splitArgPath(base.remote.path);
		if (base.remote.url !== head.remote.url) {
			const targetDesc = {
				owner: baseOwner,
				name: baseName,
			};
			const integrationId = remoteProviderIdToIntegrationId(this.id);
			const integration = integrationId && (await this.container.integrations.get(integrationId));
			let targetRepoId = undefined;
			if (integration?.isConnected && integration instanceof HostingIntegration) {
				targetRepoId = (await integration.getRepoInfo?.(targetDesc))?.id;
			}
			if (!targetRepoId) {
				return undefined;
			}
			query.set('targetRepoId', targetRepoId);
		}
		if (options?.title) {
			query.set('title', options.title);
		}
		if (options?.description) {
			query.set('description', options.description);
		}
		const [headOwner, headName] = this.splitArgPath(head.remote.path);
		return `${this.encodeUrl(
			`${this.protocol}://${this.domain}/projects/${headOwner}/repos/${headName}/pull-requests?create`,
		)}&${query.toString()}`;
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
		let line;
		if (range != null) {
			if (range.start.line === range.end.line) {
				line = `#${range.start.line}`;
			} else {
				line = `#${range.start.line}-${range.end.line}`;
			}
		} else {
			line = '';
		}
		if (sha) return `${this.encodeUrl(`${this.baseUrl}/browse/${fileName}?at=${sha}`)}${line}`;
		if (branch) return `${this.encodeUrl(`${this.baseUrl}/browse/${fileName}?at=${branch}`)}${line}`;
		return `${this.encodeUrl(`${this.baseUrl}/browse/${fileName}`)}${line}`;
	}
}
