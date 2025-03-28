import type { Range } from 'vscode';
import { Uri } from 'vscode';
import type {
	Autolink,
	AutolinkReference,
	DynamicAutolinkReference,
	MaybeEnrichedAutolink,
} from '../../autolinks/models/autolinks';
import { GlyphChars } from '../../constants';
import type { Source } from '../../constants.telemetry';
import type { Container } from '../../container';
import type { GitHubRepositoryDescriptor } from '../../plus/integrations/providers/github';
import type { Brand, Unbrand } from '../../system/brand';
import { fromNow } from '../../system/date';
import { memoize } from '../../system/decorators/-webview/memoize';
import { encodeUrl } from '../../system/encoding';
import { escapeMarkdown, unescapeMarkdown } from '../../system/markdown';
import { equalsIgnoreCase } from '../../system/string';
import type { CreatePullRequestRemoteResource } from '../models/remoteResource';
import type { Repository } from '../models/repository';
import type { GkProviderId } from '../models/repositoryIdentities';
import type { GitRevisionRangeNotation } from '../models/revision';
import { getIssueOrPullRequestMarkdownIcon } from '../utils/-webview/icons';
import { describePullRequestWithAI } from '../utils/-webview/pullRequest.utils';
import { isSha } from '../utils/revision.utils';
import type { LocalInfoFromRemoteUriResult, RemoteProviderId, RemoteProviderSupportedFeatures } from './remoteProvider';
import { RemoteProvider } from './remoteProvider';

const autolinkFullIssuesRegex = /\b([^/\s]+\/[^/\s]+?)(?:\\)?#([0-9]+)\b(?!]\()/g;
const fileRegex = /^\/([^/]+)\/([^/]+?)\/blob(.+)$/i;
const rangeRegex = /^L(\d+)(?:-L(\d+))?$/;

function isGitHubDotCom(domain: string): boolean {
	return equalsIgnoreCase(domain, 'github.com');
}

export class GitHubRemote extends RemoteProvider<GitHubRepositoryDescriptor> {
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

	get apiBaseUrl(): string {
		return this.custom ? `${this.protocol}://${this.domain}/api/v3` : `https://api.${this.domain}`;
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
					title: `Open Issue or Pull Request #<num> on ${this.name}`,

					description: `${this.name} Issue or Pull Request #<num>`,
				},
				{
					prefix: 'gh-',
					url: this.issueLinkPattern,
					alphanumeric: false,
					ignoreCase: true,
					title: `Open Issue or Pull Request #<num> on ${this.name}`,

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
														issue.closedDate ?? issue.createdDate,
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
								alphanumeric: false,
								ignoreCase: true,
								title: `Open Issue or Pull Request #<num> from ${ownerAndRepo} on ${this.name}`,

								description: `${this.name} Issue or Pull Request ${ownerAndRepo}#${num}`,

								descriptor: {
									key: this.remoteKey,
									owner: owner,
									name: repo,
								} satisfies GitHubRepositoryDescriptor,
							});
						} while (true);
					},
				},
			];
		}
		return this._autolinks;
	}

	override get avatarUri(): Uri {
		const [owner] = this.splitPath(this.path);
		return Uri.parse(`https://avatars.githubusercontent.com/${owner}`);
	}

	override get icon(): string {
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

	get name(): string {
		return this.formatName('GitHub');
	}

	@memoize()
	override get repoDesc(): GitHubRepositoryDescriptor {
		const [owner, repo] = this.splitPath(this.path);
		return { key: this.remoteKey, owner: owner, name: repo };
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

		if (possibleBranches.size) {
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
		return this.encodeUrl(`${this.baseUrl}/tree/${branch}`);
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(`${this.baseUrl}/commit/${sha}`);
	}

	protected override getUrlForComparison(base: string, head: string, notation: GitRevisionRangeNotation): string {
		return this.encodeUrl(`${this.baseUrl}/compare/${base}${notation}${head}`);
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

		const query = new URLSearchParams({ expand: '1' });
		if (details?.title) {
			query.set('title', details.title);
		}
		if (details?.description) {
			query.set('body', details.description);
		}

		if (base.remote.url === head.remote.url) {
			return base.branch
				? `${this.encodeUrl(`${this.baseUrl}/compare/${base.branch}...${head.branch}`)}?${query.toString()}`
				: `${this.encodeUrl(`${this.baseUrl}/compare/${head.branch}`)}?${query.toString()}`;
		}

		const [owner] = head.remote.path.split('/', 1);
		return `${this.encodeUrl(
			`${this.baseUrl}/compare/${base.branch ?? 'HEAD'}...${owner}:${head.branch}`,
		)}?${query.toString()}`;
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
