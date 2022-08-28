import type { AuthenticationSession, Disposable, QuickInputButton, Range } from 'vscode';
import { env, ThemeIcon, Uri, window } from 'vscode';
import type { Autolink, DynamicAutolinkReference } from '../../annotations/autolinks';
import type { AutolinkReference } from '../../config';
import { AutolinkType } from '../../config';
import type { Container } from '../../container';
import type {
	IntegrationAuthenticationProvider,
	IntegrationAuthenticationSessionDescriptor,
} from '../../plus/integrationAuthentication';
import { isSubscriptionPaidPlan, isSubscriptionPreviewTrialExpired } from '../../subscription';
import { log } from '../../system/decorators/log';
import { equalsIgnoreCase } from '../../system/string';
import type { Account } from '../models/author';
import type { DefaultBranch } from '../models/defaultBranch';
import type { IssueOrPullRequest } from '../models/issue';
import type { PullRequest, PullRequestState } from '../models/pullRequest';
import { GitRevision } from '../models/reference';
import type { Repository } from '../models/repository';
import { RichRemoteProvider } from './provider';

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

					type: AutolinkType.Issue,
					description: `Issue #<num> on ${this.name}`,
				},
				{
					prefix: '!',
					url: `${this.baseUrl}/-/merge_requests/<num>`,
					title: `Open Merge Request !<num> on ${this.name}`,

					type: AutolinkType.PullRequest,
					description: `Merge Request !<num> on ${this.name}`,
				},
				{
					linkify: (text: string) =>
						text.replace(
							autolinkFullIssuesRegex,
							`[$&](${this.protocol}://${this.domain}/$<repo>/-/issues/$<num> "Open Issue #$<num> from $<repo> on ${this.name}")`,
						),
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

								type: AutolinkType.Issue,
								description: `Issue #${num} from ${repo} on ${this.name}`,
							});
						} while (true);
					},
				},
				{
					linkify: (text: string) =>
						text.replace(
							autolinkFullMergeRequestsRegex,
							`[$&](${this.protocol}://${this.domain}/$<repo>/-/merge_requests/$<num> "Open Merge Request !$<num> from $<repo> on ${this.name}")`,
						),
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

								type: AutolinkType.PullRequest,
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
			const title =
				'Connecting to a GitLab self-managed instance for rich integration features requires a paid GitLens+ account.';

			while (true) {
				const subscription = await this.container.subscription.getSubscription();
				if (subscription.account?.verified === false) {
					const resend = { title: 'Resend Verification' };
					const cancel = { title: 'Cancel', isCloseAffordance: true };
					const result = await window.showWarningMessage(
						`${title}\n\nYou must verify your GitLens+ account email address before you can continue.`,
						{ modal: true },
						resend,
						cancel,
					);

					if (result === resend) {
						if (await this.container.subscription.resendVerification()) {
							continue;
						}
					}

					return false;
				}

				const plan = subscription.plan.effective.id;
				if (isSubscriptionPaidPlan(plan)) break;

				if (subscription.account == null && !isSubscriptionPreviewTrialExpired(subscription)) {
					const startTrial = { title: 'Try GitLens+' };
					const cancel = { title: 'Cancel', isCloseAffordance: true };
					const result = await window.showWarningMessage(
						`${title}\n\nDo you want to try GitLens+ free for 3 days?`,
						{ modal: true },
						startTrial,
						cancel,
					);

					if (result !== startTrial) return false;

					void this.container.subscription.startPreviewTrial();
					break;
				} else if (subscription.account == null) {
					const signIn = { title: 'Sign In to GitLens+' };
					const cancel = { title: 'Cancel', isCloseAffordance: true };
					const result = await window.showWarningMessage(
						`${title}\n\nDo you want to sign in to GitLens+?`,
						{ modal: true },
						signIn,
						cancel,
					);

					if (result === signIn) {
						if (await this.container.subscription.loginOrSignUp()) {
							continue;
						}
					}
				} else {
					const upgrade = { title: 'Upgrade Account' };
					const cancel = { title: 'Cancel', isCloseAffordance: true };
					const result = await window.showWarningMessage(
						`${title}\n\nDo you want to upgrade your account?`,
						{ modal: true },
						upgrade,
						cancel,
					);

					if (result === upgrade) {
						void this.container.subscription.purchase();
					}
				}

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
			if (GitRevision.isSha(sha)) {
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

	protected async getProviderAccountForCommit(
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

	protected async getProviderAccountForEmail(
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

	protected async getProviderDefaultBranch({
		accessToken,
	}: AuthenticationSession): Promise<DefaultBranch | undefined> {
		const [owner, repo] = this.splitPath();
		return (await this.container.gitlab)?.getDefaultBranch(this, accessToken, owner, repo, {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected async getProviderIssueOrPullRequest(
		{ accessToken }: AuthenticationSession,
		id: string,
	): Promise<IssueOrPullRequest | undefined> {
		const [owner, repo] = this.splitPath();
		return (await this.container.gitlab)?.getIssueOrPullRequest(this, accessToken, owner, repo, Number(id), {
			baseUrl: this.apiBaseUrl,
		});
	}

	protected async getProviderPullRequestForBranch(
		{ accessToken }: AuthenticationSession,
		branch: string,
		options?: {
			avatarSize?: number;
			include?: PullRequestState[];
		},
	): Promise<PullRequest | undefined> {
		const [owner, repo] = this.splitPath();
		const { include, ...opts } = options ?? {};

		const GitLabMergeRequest = (await import(/* webpackChunkName: "gitlab" */ '../../plus/gitlab/models'))
			.GitLabMergeRequest;
		return (await this.container.gitlab)?.getPullRequestForBranch(this, accessToken, owner, repo, branch, {
			...opts,
			include: include?.map(s => GitLabMergeRequest.toState(s)),
			baseUrl: this.apiBaseUrl,
		});
	}

	protected async getProviderPullRequestForCommit(
		{ accessToken }: AuthenticationSession,
		ref: string,
	): Promise<PullRequest | undefined> {
		const [owner, repo] = this.splitPath();
		return (await this.container.gitlab)?.getPullRequestForCommit(this, accessToken, owner, repo, ref, {
			baseUrl: this.apiBaseUrl,
		});
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
				tooltip: 'Open Access Tokens page on GitLab',
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
				input.prompt = 'Paste your GitLab Personal Access Token';
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
