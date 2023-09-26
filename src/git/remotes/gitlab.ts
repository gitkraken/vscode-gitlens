import type { AuthenticationSession, Disposable, QuickInputButton, Range } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import type { Autolink, DynamicAutolinkReference } from '../../annotations/autolinks';
import type { AutolinkReference } from '../../config';
import type { Container } from '../../container';
import type {
	IntegrationAuthenticationProvider,
	IntegrationAuthenticationSessionDescriptor,
} from '../../plus/integrationAuthentication';
import { log } from '../../system/decorators/log';
import { encodeUrl } from '../../system/encoding';
import { equalsIgnoreCase } from '../../system/string';
import { supportedInVSCodeVersion } from '../../system/utils';
import type { Account } from '../models/author';
import type { DefaultBranch } from '../models/defaultBranch';
import type { IssueOrPullRequest, SearchedIssue } from '../models/issue';
import type { PullRequest, PullRequestState, SearchedPullRequest } from '../models/pullRequest';
import { isSha } from '../models/reference';
import type { Repository } from '../models/repository';
import type { RepositoryMetadata } from '../models/repositoryMetadata';
import { ensurePaidPlan, RichRemoteProvider } from './richRemoteProvider';

const autolinkFullIssuesRegex = /\b(?<repo>[^/\s]+\/[^/\s]+)#(?<num>[0-9]+)\b(?!]\()/g;
const autolinkFullMergeRequestsRegex = /\b(?<repo>[^/\s]+\/[^/\s]+)!(?<num>[0-9]+)\b(?!]\()/g;
const fileRegex = /^\/([^/]+)\/([^/]+?)\/-\/blob(.+)$/i;
const rangeRegex = /^L(\d+)(?:-(\d+))?$/;

const authProvider = Object.freeze({ id: 'gitlab', scopes: ['read_api', 'read_user', 'read_repository'] });

export class GitLabRemote extends RichRemoteProvider {
	protected get authProvider() {
		return authProvider;
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
	}

	get apiBaseUrl() {
		return this.custom ? `${this.protocol}://${this.domain}/api` : `https://${this.domain}/api`;
	}

	private _autolinks: (AutolinkReference | DynamicAutolinkReference)[] | undefined;
	override get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		if (this._autolinks === undefined) {
			this._autolinks = [
				{
					prefix: '#',
					url: `${this.baseUrl}/-/issues/<num>`,
					title: `Open Issue #<num> on ${this.name}`,

					type: 'issue',
					description: `${this.name} Issue #<num>`,
				},
				{
					prefix: '!',
					url: `${this.baseUrl}/-/merge_requests/<num>`,
					title: `Open Merge Request !<num> on ${this.name}`,

					type: 'pullrequest',
					description: `${this.name} Merge Request !<num>`,
				},
				{
					tokenize: (
						text: string,
						outputFormat: 'html' | 'markdown' | 'plaintext',
						tokenMapping: Map<string, string>,
					) => {
						return outputFormat === 'plaintext'
							? text
							: text.replace(autolinkFullIssuesRegex, (linkText: string, repo: string, num: string) => {
									const url = encodeUrl(`${this.protocol}://${this.domain}/${repo}/-/issues/${num}`);
									const title = ` "Open Issue #${num} from ${repo} on ${this.name}"`;

									const token = `\x00${tokenMapping.size}\x00`;
									if (outputFormat === 'markdown') {
										tokenMapping.set(token, `[${linkText}](${url}${title})`);
									} else if (outputFormat === 'html') {
										tokenMapping.set(token, `<a href="${url}" title=${title}>${linkText}</a>`);
									}

									return token;
							  });
					},
					parse: (text: string, autolinks: Map<string, Autolink>) => {
						let repo: string;
						let num: string;

						let match;
						do {
							match = autolinkFullIssuesRegex.exec(text);
							if (match?.groups == null) break;

							({ repo, num } = match.groups);

							autolinks.set(num, {
								provider: this,
								id: num,
								prefix: `${repo}#`,
								url: `${this.protocol}://${this.domain}/${repo}/-/issues/${num}`,
								title: `Open Issue #<num> from ${repo} on ${this.name}`,

								type: 'issue',
								description: `${this.name} Issue ${repo}#${num}`,
							});
						} while (true);
					},
				},
				{
					tokenize: (
						text: string,
						outputFormat: 'html' | 'markdown' | 'plaintext',
						tokenMapping: Map<string, string>,
					) => {
						return outputFormat === 'plaintext'
							? text
							: text.replace(
									autolinkFullMergeRequestsRegex,
									(linkText: string, repo: string, num: string) => {
										const url = encodeUrl(
											`${this.protocol}://${this.domain}/${repo}/-/merge_requests/${num}`,
										);
										const title = ` "Open Merge Request !${num} from ${repo} on ${this.name}"`;

										const token = `\x00${tokenMapping.size}\x00`;
										if (outputFormat === 'markdown') {
											tokenMapping.set(token, `[${linkText}](${url}${title})`);
										} else if (outputFormat === 'html') {
											tokenMapping.set(token, `<a href="${url}" title=${title}>${linkText}</a>`);
										}

										return token;
									},
							  );
					},
					parse: (text: string, autolinks: Map<string, Autolink>) => {
						let repo: string;
						let num: string;

						let match;
						do {
							match = autolinkFullMergeRequestsRegex.exec(text);
							if (match?.groups == null) break;

							({ repo, num } = match.groups);

							autolinks.set(num, {
								provider: this,
								id: num,
								prefix: `${repo}!`,
								url: `${this.protocol}://${this.domain}/${repo}/-/merge_requests/${num}`,
								title: `Open Merge Request !<num> from ${repo} on ${this.name}`,

								type: 'pullrequest',
								description: `Merge Request !${num} from ${repo} on ${this.name}`,
							});
						} while (true);
					},
				},
			];
		}
		return this._autolinks;
	}

	override get icon() {
		return 'gitlab';
	}

	get id() {
		return 'gitlab';
	}

	get name() {
		return this.formatName('GitLab');
	}

	@log()
	override async connect(): Promise<boolean> {
		if (!equalsIgnoreCase(this.domain, 'gitlab.com')) {
			if (!(await ensurePaidPlan('GitLab self-managed instance', this.container))) {
				return false;
			}
		}

		return super.connect();
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
		return this.encodeUrl(`${this.baseUrl}/-/branches`);
	}

	protected getUrlForBranch(branch: string): string {
		return this.encodeUrl(`${this.baseUrl}/-/tree/${branch}`);
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(`${this.baseUrl}/-/commit/${sha}`);
	}

	protected override getUrlForComparison(base: string, compare: string, notation: '..' | '...'): string {
		return this.encodeUrl(`${this.baseUrl}/-/compare/${base}${notation}${compare}`);
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
		let line;
		if (range != null) {
			if (range.start.line === range.end.line) {
				line = `#L${range.start.line}`;
			} else {
				line = `#L${range.start.line}-${range.end.line}`;
			}
		} else {
			line = '';
		}

		if (sha) return `${this.encodeUrl(`${this.baseUrl}/-/blob/${sha}/${fileName}`)}${line}`;
		if (branch) return `${this.encodeUrl(`${this.baseUrl}/-/blob/${branch}/${fileName}`)}${line}`;
		return `${this.encodeUrl(`${this.baseUrl}?path=${fileName}`)}${line}`;
	}

	protected override async getProviderAccountForCommit(
		{ accessToken }: AuthenticationSession,
		ref: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const [owner, repo] = this.splitPath();
		return (await this.container.gitlab)?.getAccountForCommit(this, accessToken, owner, repo, ref, {
			...options,
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderAccountForEmail(
		{ accessToken }: AuthenticationSession,
		email: string,
		options?: {
			avatarSize?: number;
		},
	): Promise<Account | undefined> {
		const [owner, repo] = this.splitPath();
		return (await this.container.gitlab)?.getAccountForEmail(this, accessToken, owner, repo, email, {
			...options,
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderDefaultBranch({
		accessToken,
	}: AuthenticationSession): Promise<DefaultBranch | undefined> {
		const [owner, repo] = this.splitPath();
		return (await this.container.gitlab)?.getDefaultBranch(this, accessToken, owner, repo, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderIssueOrPullRequest(
		{ accessToken }: AuthenticationSession,
		id: string,
	): Promise<IssueOrPullRequest | undefined> {
		const [owner, repo] = this.splitPath();
		return (await this.container.gitlab)?.getIssueOrPullRequest(this, accessToken, owner, repo, Number(id), {
			baseUrl: this.apiBaseUrl,
		});
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

		const toGitLabMergeRequestState = (await import(/* webpackChunkName: "gitlab" */ '../../plus/gitlab/models'))
			.toGitLabMergeRequestState;
		return (await this.container.gitlab)?.getPullRequestForBranch(this, accessToken, owner, repo, branch, {
			...opts,
			include: include?.map(s => toGitLabMergeRequestState(s)),
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderPullRequestForCommit(
		{ accessToken }: AuthenticationSession,
		ref: string,
	): Promise<PullRequest | undefined> {
		const [owner, repo] = this.splitPath();
		return (await this.container.gitlab)?.getPullRequestForCommit(this, accessToken, owner, repo, ref, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async getProviderRepositoryMetadata({
		accessToken,
	}: AuthenticationSession): Promise<RepositoryMetadata | undefined> {
		const [owner, repo] = this.splitPath();
		return (await this.container.gitlab)?.getRepositoryMetadata(this, accessToken, owner, repo, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected override async searchProviderMyPullRequests(
		_session: AuthenticationSession,
	): Promise<SearchedPullRequest[] | undefined> {
		return Promise.resolve(undefined);
	}

	protected override async searchProviderMyIssues(
		_session: AuthenticationSession,
	): Promise<SearchedIssue[] | undefined> {
		return Promise.resolve(undefined);
	}
}

export class GitLabAuthenticationProvider implements Disposable, IntegrationAuthenticationProvider {
	private readonly _disposable: Disposable;

	constructor(container: Container) {
		this._disposable = container.integrationAuthentication.registerProvider('gitlab', this);
	}

	dispose() {
		this._disposable.dispose();
	}

	getSessionId(descriptor?: IntegrationAuthenticationSessionDescriptor): string {
		return descriptor?.domain ?? '';
	}

	async createSession(
		descriptor?: IntegrationAuthenticationSessionDescriptor,
	): Promise<AuthenticationSession | undefined> {
		const input = window.createInputBox();
		input.ignoreFocusOut = true;

		const disposables: Disposable[] = [];

		let token;
		try {
			const infoButton: QuickInputButton = {
				iconPath: new ThemeIcon(`link-external`),
				tooltip: 'Open the GitLab Access Tokens Page',
			};

			token = await new Promise<string | undefined>(resolve => {
				disposables.push(
					input.onDidHide(() => resolve(undefined)),
					input.onDidChangeValue(() => (input.validationMessage = undefined)),
					input.onDidAccept(() => {
						const value = input.value.trim();
						if (!value) {
							input.validationMessage = 'A personal access token is required';
							return;
						}

						resolve(value);
					}),
					input.onDidTriggerButton(e => {
						if (e === infoButton) {
							void env.openExternal(
								Uri.parse(
									`https://${descriptor?.domain ?? 'gitlab.com'}/-/profile/personal_access_tokens`,
								),
							);
						}
					}),
				);

				input.password = true;
				input.title = `GitLab Authentication${descriptor?.domain ? `  \u2022 ${descriptor.domain}` : ''}`;
				input.placeholder = `Requires ${descriptor?.scopes.join(', ') ?? 'all'} scopes`;
				input.prompt = input.prompt = supportedInVSCodeVersion('input-prompt-links')
					? `Paste your [GitLab Personal Access Token](https://${
							descriptor?.domain ?? 'gitlab.com'
					  }/-/profile/personal_access_tokens "Get your GitLab Access Token")`
					: 'Paste your GitLab Personal Access Token';
				input.buttons = [infoButton];

				input.show();
			});
		} finally {
			input.dispose();
			disposables.forEach(d => void d.dispose());
		}

		if (!token) return undefined;

		return {
			id: this.getSessionId(descriptor),
			accessToken: token,
			scopes: [],
			account: {
				id: '',
				label: '',
			},
		};
	}
}
