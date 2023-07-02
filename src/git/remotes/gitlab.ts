'use strict';
import { Range, Uri } from 'vscode';
import { DynamicAutolinkReference } from '../../annotations/autolinks';
import { AutolinkReference } from '../../config';
import { GitRevision } from '../models/models';
import { Repository } from '../models/repository';
import { RemoteProvider } from './provider';

const autolinkFullIssuesRegex = /\b(?<repo>[^/\s]+\/[^/\s]+)#(?<num>[0-9]+)\b(?!]\()/g;
const autolinkFullMergeRequestsRegex = /\b(?<repo>[^/\s]+\/[^/\s]+)!(?<num>[0-9]+)\b(?!]\()/g;
const fileRegex = /^\/([^/]+)\/([^/]+?)\/-\/blob(.+)$/i;
const rangeRegex = /^L(\d+)(?:-(\d+))?$/;

export class GitLabRemote extends RemoteProvider {
	constructor(domain: string, path: string, protocol?: string, name?: string, custom: boolean = false) {
		super(domain, path, protocol, name, custom);
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
					description: `${this.name} Issue #<num>`,
				},
				{
					prefix: '!',
					url: `${this.baseUrl}/-/merge_requests/<num>`,
					title: `Open Merge Request !<num> on ${this.name}`,

					type: AutolinkType.PullRequest,
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

								type: AutolinkType.Issue,
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
}
