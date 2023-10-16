import type { AuthenticationSession, Range } from 'vscode';
import { Uri } from 'vscode';
import type { Autolink, DynamicAutolinkReference, MaybeEnrichedAutolink } from '../../annotations/autolinks';
import type { AutolinkReference } from '../../config';
import { GlyphChars } from '../../constants';
import type { Container } from '../../container';
import type { GkProviderId } from '../../gk/models/repositoryIdentities';
import type { GitHubRepositoryDescriptor } from '../../plus/integrations/providers/github';
import { ProviderId } from '../../plus/integrations/providers/models';
import type { ProviderIntegration, RepositoryDescriptor } from '../../plus/integrations/providers/providerIntegration';
import type { Brand, Unbrand } from '../../system/brand';
import { fromNow } from '../../system/date';
import { log } from '../../system/decorators/log';
import { memoize } from '../../system/decorators/memoize';
import { encodeUrl } from '../../system/encoding';
import { equalsIgnoreCase, escapeMarkdown, unescapeMarkdown } from '../../system/string';
import type { Account } from '../models/author';
import type { DefaultBranch } from '../models/defaultBranch';
import type { IssueOrPullRequest, SearchedIssue } from '../models/issue';
import { getIssueOrPullRequestMarkdownIcon } from '../models/issue';
import type { PullRequest, PullRequestState, SearchedPullRequest } from '../models/pullRequest';
import { isSha } from '../models/reference';
import type { Repository } from '../models/repository';
import type { RepositoryMetadata } from '../models/repositoryMetadata';
import type { RemoteProviderId } from './remoteProvider';
import { RichRemoteProvider } from './richRemoteProvider';

const autolinkFullIssuesRegex = /\b([^/\s]+\/[^/\s]+?)(?:\\)?#([0-9]+)\b(?!]\()/g;
const fileRegex = /^\/([^/]+)\/([^/]+?)\/blob(.+)$/i;
const rangeRegex = /^L(\d+)(?:-L(\d+))?$/;

// const authProvider = Object.freeze({ id: 'github', scopes: ['repo', 'read:user', 'user:email'] });
// const enterpriseAuthProvider = Object.freeze({ id: 'github-enterprise', scopes: ['repo', 'read:user', 'user:email'] });

function isGitHubDotCom(domain: string): boolean {
	return equalsIgnoreCase(domain, 'github.com');
}

export class GitHubRemote extends RichRemoteProvider<GitHubRepositoryDescriptor> {
	private readonly _provider: ProviderIntegration;

	@memoize()
	protected get authProvider() {
		return this._provider.authProvider;
		// return isGitHubDotCom(this.domain) ? authProvider : enterpriseAuthProvider;
	}

	constructor(
		container: Container,
		domain: string,
		path: string,
		protocol?: string,
		name?: string,
		custom: boolean = false,
	) {
		super(container, domain, path, protocol, name, custom);

		this._provider = container.providers.get(custom ? ProviderId.GitHubEnterprise : ProviderId.GitHub, domain);
	}

	get apiBaseUrl() {
		return this.custom ? `${this.protocol}://${this.domain}/api/v3` : `https://api.${this.domain}`;
	}

	private _autolinks: (AutolinkReference | DynamicAutolinkReference)[] | undefined;
	override get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		if (this._autolinks === undefined) {
			this._autolinks = [
				{
					prefix: '#',
					url: `${this.baseUrl}/issues/<num>`,
					title: `Open Issue or Pull Request #<num> on ${this.name}`,

					description: `${this.name} Issue or Pull Request #<num>`,
				},
				{
					prefix: 'gh-',
					url: `${this.baseUrl}/issues/<num>`,
					title: `Open Issue or Pull Request #<num> on ${this.name}`,
					ignoreCase: true,

					description: `${this.name} Issue or Pull Request #<num>`,
				},
				{
					tokenize: (
						text: string,
						outputFormat: 'html' | 'markdown' | 'plaintext',
						tokenMapping: Map<string, string>,
						enrichedAutolinks?: Map<string, MaybeEnrichedAutolink>,
						prs?: Set<string>,
						footnotes?: Map<number, string>,
					) => {
						return outputFormat === 'plaintext'
							? text
							: text.replace(autolinkFullIssuesRegex, (linkText: string, repo: string, num: string) => {
									const url = encodeUrl(
										`${this.protocol}://${this.domain}/${unescapeMarkdown(repo)}/issues/${num}`,
									);
									const title = ` "Open Issue or Pull Request #${num} from ${repo} on ${this.name}"`;

									const token = `\x00${tokenMapping.size}\x00`;
									if (outputFormat === 'markdown') {
										tokenMapping.set(token, `[${linkText}](${url}${title})`);
									} else if (outputFormat === 'html') {
										tokenMapping.set(token, `<a href="${url}" title=${title}>${linkText}</a>`);
									}

									let footnoteIndex: number;

									const issueResult = enrichedAutolinks?.get(num)?.[0];
									if (issueResult?.value != null) {
										if (issueResult.paused) {
											if (footnotes != null && !prs?.has(num)) {
												footnoteIndex = footnotes.size + 1;
												footnotes.set(
													footnoteIndex,
													`[${getIssueOrPullRequestMarkdownIcon()} ${
														this.name
													} Issue or Pull Request ${repo}#${num} $(loading~spin)](${url}${title}")`,
												);
											}
										} else {
											const issue = issueResult.value;
											const issueTitle = escapeMarkdown(issue.title.trim());
											if (footnotes != null && !prs?.has(num)) {
												footnoteIndex = footnotes.size + 1;
												footnotes.set(
													footnoteIndex,
													`[${getIssueOrPullRequestMarkdownIcon(
														issue,
													)} **${issueTitle}**](${url}${title})\\\n${GlyphChars.Space.repeat(
														5,
													)}${linkText} ${issue.state} ${fromNow(
														issue.closedDate ?? issue.date,
													)}`,
												);
											}
										}
									} else if (footnotes != null && !prs?.has(num)) {
										footnoteIndex = footnotes.size + 1;
										footnotes.set(
											footnoteIndex,
											`[${getIssueOrPullRequestMarkdownIcon()} ${
												this.name
											} Issue or Pull Request ${repo}#${num}](${url}${title})`,
										);
									}

									return token;
							  });
					},
					parse: (text: string, autolinks: Map<string, Autolink>) => {
						let ownerAndRepo: string;
						let num: string;

						let match;
						do {
							match = autolinkFullIssuesRegex.exec(text);
							if (match == null) break;

							[, ownerAndRepo, num] = match;

							const [owner, repo] = ownerAndRepo.split('/', 2);
							autolinks.set(num, {
								provider: this,
								id: num,
								prefix: `${ownerAndRepo}#`,
								url: `${this.protocol}://${this.domain}/${ownerAndRepo}/issues/${num}`,
								title: `Open Issue or Pull Request #<num> from ${ownerAndRepo} on ${this.name}`,

								description: `${this.name} Issue or Pull Request ${ownerAndRepo}#${num}`,

								descriptor: { owner: owner, name: repo } satisfies GitHubRepositoryDescriptor,
							});
						} while (true);
					},
				},
			];
		}
		return this._autolinks;
	}

	override get avatarUri() {
		const [owner] = this.splitPath();
		return Uri.parse(`https://avatars.githubusercontent.com/${owner}`);
	}

	override get icon() {
		return 'github';
	}

	get id(): RemoteProviderId {
		return 'github';
	}

	get gkProviderId(): GkProviderId {
		return (!isGitHubDotCom(this.domain)
			? 'githubEnterprise'
			: 'github') satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
	}

	get name() {
		return this.formatName('GitHub');
	}

	@log()
	override async connect(): Promise<boolean> {
		return this._provider.connect();
		// if (!isGitHubDotCom(this.domain)) {
		// 	if (!(await ensurePaidPlan('GitHub Enterprise instance', this.container))) {
		// 		return false;
		// 	}
		// }

		// return super.connect();
	}

	override disconnect(
		options?: { silent?: boolean | undefined; currentSessionOnly?: boolean | undefined } | undefined,
	): Promise<void> {
		return this._provider.disconnect(options);
	}

	override get maybeConnected(): boolean | undefined {
		return this._provider.maybeConnected;
	}

	override async reauthenticate(): Promise<void> {
		return this._provider.reauthenticate();
	}

	override resetRequestExceptionCount(): void {
		this._provider.resetRequestExceptionCount();
	}

	override trackRequestException(): void {
		this._provider.trackRequestException();
	}

	protected override ensureSession(
		createIfNeeded: boolean,
		forceNewSession?: boolean,
	): Promise<AuthenticationSession | undefined> {
		return this._provider.ensureSession(createIfNeeded, forceNewSession);
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
				const uri = repository.toAbsoluteUri(path.substr(index), { validate: options?.validate });
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

			possibleBranches.set(branch, path.substr(index));
		} while (index > 0);

		if (possibleBranches.size !== 0) {
			const { values: branches } = await repository.getBranches({
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
		return this.encodeUrl(`${this.baseUrl}/tree/${branch}`);
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(`${this.baseUrl}/commit/${sha}`);
	}

	protected override getUrlForComparison(base: string, compare: string, notation: '..' | '...'): string {
		return this.encodeUrl(`${this.baseUrl}/compare/${base}${notation}${compare}`);
	}

	protected override getUrlForCreatePullRequest(
		base: { branch?: string; remote: { path: string; url: string } },
		compare: { branch: string; remote: { path: string; url: string } },
	): string | undefined {
		if (base.remote.url === compare.remote.url) {
			return this.encodeUrl(`${this.baseUrl}/pull/new/${base.branch ?? 'HEAD'}...${compare.branch}`);
		}

		const [owner] = compare.remote.path.split('/', 1);
		return this.encodeUrl(`${this.baseUrl}/pull/new/${base.branch ?? 'HEAD'}...${owner}:${compare.branch}`);
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

		if (sha) return `${this.encodeUrl(`${this.baseUrl}/blob/${sha}/${fileName}`)}${line}`;
		if (branch) return `${this.encodeUrl(`${this.baseUrl}/blob/${branch}/${fileName}`)}${line}`;
		return `${this.encodeUrl(`${this.baseUrl}?path=${fileName}`)}${line}`;
	}

	private get repositoryDescriptor(): RepositoryDescriptor {
		const [owner, repo] = this.splitPath();
		return { owner: owner, name: repo };
	}

	override async getAccountForCommit(
		ref: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return this._provider.getAccountForCommit(this.repositoryDescriptor, ref, options);
	}

	protected override async getProviderAccountForCommit(
		{ accessToken }: AuthenticationSession,
		ref: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const [owner, repo] = this.splitPath();
		return (await this.container.github)?.getAccountForCommit(this, accessToken, owner, repo, ref, {
			...options,
			baseUrl: this.apiBaseUrl,
		});
	}

	override async getAccountForEmail(
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		return this._provider.getAccountForEmail(this.repositoryDescriptor, email, options);
	}

	protected override async getProviderAccountForEmail(
		{ accessToken }: AuthenticationSession,
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const [owner, repo] = this.splitPath();
		return (await this.container.github)?.getAccountForEmail(this, accessToken, owner, repo, email, {
			...options,
			baseUrl: this.apiBaseUrl,
		});
	}

	override async getDefaultBranch(): Promise<DefaultBranch | undefined> {
		return this._provider.getDefaultBranch(this.repositoryDescriptor);
	}

	protected override async getProviderDefaultBranch({
		accessToken,
	}: AuthenticationSession): Promise<DefaultBranch | undefined> {
		const [owner, repo] = this.splitPath();
		return (await this.container.github)?.getDefaultBranch(this, accessToken, owner, repo, {
			baseUrl: this.apiBaseUrl,
		});
	}

	override async getIssueOrPullRequest(
		id: string,
		repo: GitHubRepositoryDescriptor | undefined,
	): Promise<IssueOrPullRequest | undefined> {
		return this._provider.getIssueOrPullRequest(repo ?? this.repositoryDescriptor, id);
	}

	protected override async getProviderIssueOrPullRequest(
		{ accessToken }: AuthenticationSession,
		id: string,
		descriptor: GitHubRepositoryDescriptor | undefined,
	): Promise<IssueOrPullRequest | undefined> {
		let owner;
		let repo;
		if (descriptor != null) {
			({ owner, name: repo } = descriptor);
		} else {
			[owner, repo] = this.splitPath();
		}
		return (await this.container.github)?.getIssueOrPullRequest(this, accessToken, owner, repo, Number(id), {
			baseUrl: this.apiBaseUrl,
		});
	}

	override async getPullRequestForBranch(
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		return this._provider.getPullRequestForBranch(this.repositoryDescriptor, branch, options);
	}

	protected override async getProviderPullRequestForBranch(
		{ accessToken }: AuthenticationSession,
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		const [owner, repo] = this.splitPath();
		const { include, ...opts } = options ?? {};

		const toGitHubPullRequestState = (await import(/* webpackChunkName: "github" */ '../../plus/github/models'))
			.toGitHubPullRequestState;
		return (await this.container.github)?.getPullRequestForBranch(this, accessToken, owner, repo, branch, {
			...opts,
			include: include?.map(s => toGitHubPullRequestState(s)),
			baseUrl: this.apiBaseUrl,
		});
	}

	override async getPullRequestForCommit(ref: string): Promise<PullRequest | undefined> {
		return this._provider.getPullRequestForCommit(this.repositoryDescriptor, ref);
	}

	protected override async getProviderPullRequestForCommit(
		{ accessToken }: AuthenticationSession,
		ref: string,
	): Promise<PullRequest | undefined> {
		const [owner, repo] = this.splitPath();
		return (await this.container.github)?.getPullRequestForCommit(this, accessToken, owner, repo, ref, {
			baseUrl: this.apiBaseUrl,
		});
	}

	override async getRepositoryMetadata(): Promise<RepositoryMetadata | undefined> {
		return this._provider.getRepositoryMetadata(this.repositoryDescriptor);
	}

	protected override async getProviderRepositoryMetadata({
		accessToken,
	}: AuthenticationSession): Promise<RepositoryMetadata | undefined> {
		const [owner, repo] = this.splitPath();
		return (await this.container.github)?.getRepositoryMetadata(this, accessToken, owner, repo, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async searchProviderMyPullRequests({
		accessToken,
	}: AuthenticationSession): Promise<SearchedPullRequest[] | undefined> {
		return (await this.container.github)?.searchMyPullRequests(this, accessToken, {
			repos: [this.path],
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async searchProviderMyIssues({
		accessToken,
	}: AuthenticationSession): Promise<SearchedIssue[] | undefined> {
		return (await this.container.github)?.searchMyIssues(this, accessToken, {
			repos: [this.path],
			baseUrl: this.apiBaseUrl,
		});
	}
}

const gitHubNoReplyAddressRegex = /^(?:(\d+)\+)?([a-zA-Z\d-]{1,39})@users\.noreply\.(.*)$/i;

export function getGitHubNoReplyAddressParts(
	email: string,
): { userId: string; login: string; authority: string } | undefined {
	const match = gitHubNoReplyAddressRegex.exec(email);
	if (match == null) return undefined;

	const [, userId, login, authority] = match;
	return { userId: userId, login: login, authority: authority };
}
