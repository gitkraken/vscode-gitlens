import type { Range, Uri } from 'vscode';
import type {
	Autolink,
	AutolinkReference,
	DynamicAutolinkReference,
	MaybeEnrichedAutolink,
} from '../../autolinks/models/autolinks';
import { GlyphChars } from '../../constants';
import type { Source } from '../../constants.telemetry';
import type { Container } from '../../container';
import { HostingIntegration } from '../../plus/integrations/integration';
import { remoteProviderIdToIntegrationId } from '../../plus/integrations/integrationService';
import type { GitLabRepositoryDescriptor } from '../../plus/integrations/providers/gitlab';
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
const autolinkFullMergeRequestsRegex = /\b([^/\s]+\/[^/\s]+?)(?:\\)?!([0-9]+)\b(?!]\()/g;
const fileRegex = /^\/([^/]+)\/([^/]+?)\/-\/blob(.+)$/i;
const rangeRegex = /^L(\d+)(?:-(\d+))?$/;

function isGitLabDotCom(domain: string): boolean {
	return equalsIgnoreCase(domain, 'gitlab.com');
}

export class GitLabRemote extends RemoteProvider<GitLabRepositoryDescriptor> {
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
		return this.custom ? `${this.protocol}://${this.domain}/api` : `https://${this.domain}/api`;
	}

	protected override get issueLinkPattern(): string {
		return `${this.baseUrl}/-/issues/<num>`;
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
				{
					prefix: '!',
					url: `${this.baseUrl}/-/merge_requests/<num>`,
					alphanumeric: false,
					ignoreCase: false,
					title: `Open Merge Request !<num> on ${this.name}`,

					type: 'pullrequest',
					description: `${this.name} Merge Request !<num>`,
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
										`${this.protocol}://${this.domain}/${unescapeMarkdown(repo)}/-/issues/${num}`,
									);
									const title = ` "Open Issue #${num} from ${repo} on ${this.name}"`;

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
													`[${getIssueOrPullRequestMarkdownIcon()} GitLab Issue ${repo}#${num} $(loading~spin)](${url}${title}")`,
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
											`[${getIssueOrPullRequestMarkdownIcon()} GitLab Issue ${repo}#${num}](${url}${title})`,
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
								url: `${this.protocol}://${this.domain}/${ownerAndRepo}/-/issues/${num}`,
								alphanumeric: false,
								ignoreCase: true,
								title: `Open Issue #<num> from ${ownerAndRepo} on ${this.name}`,

								type: 'issue',
								description: `${this.name} Issue ${ownerAndRepo}#${num}`,
								descriptor: {
									key: this.remoteKey,
									owner: owner,
									name: repo,
								} satisfies GitLabRepositoryDescriptor,
							});
						} while (true);
					},
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
														} Merge Request ${repo}!${num} $(loading~spin)](${url}${title}")`,
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
												} Merge Request ${repo}!${num}](${url}${title})`,
											);
										}
										return token;
									},
							  );
					},
					parse: (text: string, autolinks: Map<string, Autolink>) => {
						let ownerAndRepo: string;
						let num: string;

						let match;
						do {
							match = autolinkFullMergeRequestsRegex.exec(text);
							if (match == null) break;

							[, ownerAndRepo, num] = match;

							const [owner, repo] = ownerAndRepo.split('/', 2);
							autolinks.set(num, {
								provider: this,
								id: num,
								prefix: `${ownerAndRepo}!`,
								url: `${this.protocol}://${this.domain}/${ownerAndRepo}/-/merge_requests/${num}`,
								alphanumeric: false,
								ignoreCase: true,
								title: `Open Merge Request !<num> from ${ownerAndRepo} on ${this.name}`,

								type: 'pullrequest',
								description: `${this.name} Merge Request !${num} from ${ownerAndRepo}`,

								descriptor: {
									key: this.remoteKey,
									owner: owner,
									name: repo,
								} satisfies GitLabRepositoryDescriptor,
							});
						} while (true);
					},
				},
			];
		}
		return this._autolinks;
	}

	override get icon(): string {
		return 'gitlab';
	}

	get id(): RemoteProviderId {
		return 'gitlab';
	}

	get gkProviderId(): GkProviderId {
		return (!isGitLabDotCom(this.domain)
			? 'gitlabSelfHosted'
			: 'gitlab') satisfies Unbrand<GkProviderId> as Brand<GkProviderId>;
	}

	get name(): string {
		return this.formatName('GitLab');
	}

	@memoize()
	override get repoDesc(): GitLabRepositoryDescriptor {
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
		return this.encodeUrl(`${this.baseUrl}/-/branches`);
	}

	protected getUrlForBranch(branch: string): string {
		return this.encodeUrl(`${this.baseUrl}/-/tree/${branch}`);
	}

	protected getUrlForCommit(sha: string): string {
		return this.encodeUrl(`${this.baseUrl}/-/commit/${sha}`);
	}

	protected override getUrlForComparison(base: string, head: string, notation: GitRevisionRangeNotation): string {
		return this.encodeUrl(`${this.baseUrl}/-/compare/${base}${notation}${head}`);
	}

	override async isReadyForForCrossForkPullRequestUrls(): Promise<boolean> {
		const integrationId = remoteProviderIdToIntegrationId(this.id);
		const integration = integrationId && (await this.container.integrations.get(integrationId));
		return integration?.maybeConnected ?? integration?.isConnected() ?? false;
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
		const query = new URLSearchParams({
			utf8: '✓',
			'merge_request[source_branch]': head.branch,
			'merge_request[target_branch]': base.branch ?? '',
		});

		if (base.remote.url !== head.remote.url) {
			const targetDesc = {
				owner: base.remote.path.split('/')[0],
				name: base.remote.path.split('/')[1],
			};
			const integrationId = remoteProviderIdToIntegrationId(this.id);
			const integration = integrationId && (await this.container.integrations.get(integrationId));

			let targetRepoId;
			if (integration?.isConnected && integration instanceof HostingIntegration) {
				targetRepoId = (await integration.getRepoInfo?.(targetDesc))?.id;
			}
			if (!targetRepoId) return undefined;

			query.set('merge_request[target_project_id]', targetRepoId);
			// 'merge_request["source_project_id"]': this.path, // ?? seems we don't need it
		}

		if (details?.title) {
			query.set('merge_request[title]', details.title);
		}
		if (details?.description) {
			query.set('merge_request[description]', details.description);
		}

		return `${this.encodeUrl(`${this.getRepoBaseUrl(head.remote.path)}/-/merge_requests/new`)}?${query.toString()}`;
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
}
