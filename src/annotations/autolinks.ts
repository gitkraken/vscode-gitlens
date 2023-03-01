import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable } from 'vscode';
import type { AutolinkReference, AutolinkType } from '../config';
import { GlyphChars } from '../constants';
import type { Container } from '../container';
import type { IssueOrPullRequest } from '../git/models/issue';
import { getIssueOrPullRequestHtmlIcon, getIssueOrPullRequestMarkdownIcon } from '../git/models/issue';
import type { GitRemote } from '../git/models/remote';
import type { RemoteProviderReference } from '../git/models/remoteProvider';
import { configuration } from '../system/configuration';
import { fromNow } from '../system/date';
import { debug } from '../system/decorators/log';
import { encodeUrl } from '../system/encoding';
import { join, map } from '../system/iterable';
import { Logger } from '../system/logger';
import type { PromiseCancelledErrorWithId } from '../system/promise';
import { PromiseCancelledError, raceAll } from '../system/promise';
import { encodeHtmlWeak, escapeMarkdown, escapeRegex, getSuperscript } from '../system/string';

const emptyAutolinkMap = Object.freeze(new Map<string, Autolink>());

const numRegex = /<num>/g;

export interface Autolink {
	provider?: RemoteProviderReference;
	id: string;
	prefix: string;
	title?: string;
	url: string;

	type?: AutolinkType;
	description?: string;
}

export function serializeAutolink(value: Autolink): Autolink {
	const serialized: Autolink = {
		provider: value.provider
			? {
					id: value.provider.id,
					name: value.provider.name,
					domain: value.provider.domain,
					icon: value.provider.icon,
			  }
			: undefined,
		id: value.id,
		prefix: value.prefix,
		title: value.title,
		url: value.url,
		type: value.type,
		description: value.description,
	};
	return serialized;
}

export interface CacheableAutolinkReference extends AutolinkReference {
	tokenize?:
		| ((
				text: string,
				outputFormat: 'html' | 'markdown' | 'plaintext',
				tokenMapping: Map<string, string>,
				issuesOrPullRequests?: Map<string, IssueOrPullRequest | PromiseCancelledError | undefined>,
				footnotes?: Map<number, string>,
		  ) => string)
		| null;

	messageHtmlRegex?: RegExp;
	messageMarkdownRegex?: RegExp;
	messageRegex?: RegExp;
}

export interface DynamicAutolinkReference {
	tokenize?:
		| ((
				text: string,
				outputFormat: 'html' | 'markdown' | 'plaintext',
				tokenMapping: Map<string, string>,
				issuesOrPullRequests?: Map<string, IssueOrPullRequest | PromiseCancelledError | undefined>,
				footnotes?: Map<number, string>,
		  ) => string)
		| null;
	parse: (text: string, autolinks: Map<string, Autolink>) => void;
}

function isDynamic(ref: AutolinkReference | DynamicAutolinkReference): ref is DynamicAutolinkReference {
	return !('prefix' in ref) && !('url' in ref);
}

function isCacheable(ref: AutolinkReference | DynamicAutolinkReference): ref is CacheableAutolinkReference {
	return 'prefix' in ref && ref.prefix != null && 'url' in ref && ref.url != null;
}

export class Autolinks implements Disposable {
	protected _disposable: Disposable | undefined;
	private _references: CacheableAutolinkReference[] = [];

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(configuration.onDidChange(this.onConfigurationChanged, this));

		this.onConfigurationChanged();
	}

	dispose() {
		this._disposable?.dispose();
	}

	private onConfigurationChanged(e?: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'autolinks')) {
			const autolinks = configuration.get('autolinks');
			// Since VS Code's configuration objects are live we need to copy them to avoid writing back to the configuration
			this._references =
				autolinks
					?.filter(a => a.prefix && a.url)
					/**
					 * Only allow properties defined by {@link AutolinkReference}
					 */
					?.map(a => ({
						prefix: a.prefix,
						url: a.url,
						title: a.title,
						alphanumeric: a.alphanumeric,
						ignoreCase: a.ignoreCase,
						type: a.type,
						description: a.description,
					})) ?? [];
		}
	}

	@debug<Autolinks['getAutolinks']>({
		args: {
			0: '<message>',
			1: false,
		},
	})
	getAutolinks(message: string, remote?: GitRemote): Map<string, Autolink> {
		const provider = remote?.provider;
		// If a remote is provided but there is no provider return an empty set
		if (remote != null && remote.provider == null) return emptyAutolinkMap;

		const autolinks = new Map<string, Autolink>();

		let match;
		let num;
		for (const ref of provider?.autolinks ?? this._references) {
			if (!isCacheable(ref)) {
				if (isDynamic(ref)) {
					ref.parse(message, autolinks);
				}
				continue;
			}

			ensureCachedRegex(ref, 'plaintext');

			do {
				match = ref.messageRegex.exec(message);
				if (match == null) break;

				[, , num] = match;

				autolinks.set(num, {
					provider: provider,
					id: num,
					prefix: ref.prefix,
					url: ref.url?.replace(numRegex, num),
					title: ref.title?.replace(numRegex, num),

					type: ref.type,
					description: ref.description?.replace(numRegex, num),
				});
			} while (true);
		}

		return autolinks;
	}

	async getLinkedIssuesAndPullRequests(
		message: string,
		remote: GitRemote,
		options?: { autolinks?: Map<string, Autolink>; timeout?: never },
	): Promise<Map<string, IssueOrPullRequest> | undefined>;
	async getLinkedIssuesAndPullRequests(
		message: string,
		remote: GitRemote,
		options: { autolinks?: Map<string, Autolink>; timeout: number },
	): Promise<
		| Map<string, IssueOrPullRequest | PromiseCancelledErrorWithId<string, Promise<IssueOrPullRequest | undefined>>>
		| undefined
	>;
	@debug<Autolinks['getLinkedIssuesAndPullRequests']>({
		args: {
			0: '<message>',
			1: false,
			2: options => `autolinks=${options?.autolinks != null}, timeout=${options?.timeout}`,
		},
	})
	async getLinkedIssuesAndPullRequests(
		message: string,
		remote: GitRemote,
		options?: { autolinks?: Map<string, Autolink>; timeout?: number },
	) {
		if (!remote.hasRichProvider()) return undefined;

		const { provider } = remote;
		const connected = provider.maybeConnected ?? (await provider.isConnected());
		if (!connected) return undefined;

		let autolinks = options?.autolinks;
		if (autolinks == null) {
			autolinks = this.getAutolinks(message, remote);
		}

		if (autolinks.size === 0) return undefined;

		const issuesOrPullRequests = await raceAll(
			autolinks.keys(),
			id => provider.getIssueOrPullRequest(id),
			options?.timeout,
		);

		// Remove any issues or pull requests that were not found
		for (const [id, issueOrPullRequest] of issuesOrPullRequests) {
			if (issueOrPullRequest == null) {
				issuesOrPullRequests.delete(id);
			}
		}

		return issuesOrPullRequests.size !== 0 ? issuesOrPullRequests : undefined;
	}

	@debug<Autolinks['linkify']>({
		args: {
			0: '<text>',
			2: remotes => remotes?.length,
			3: issuesOrPullRequests => issuesOrPullRequests?.size,
			4: footnotes => footnotes?.size,
		},
	})
	linkify(
		text: string,
		outputFormat: 'html' | 'markdown' | 'plaintext',
		remotes?: GitRemote[],
		issuesOrPullRequests?: Map<string, IssueOrPullRequest | PromiseCancelledError | undefined>,
		footnotes?: Map<number, string>,
	): string {
		const includeFootnotesInText = outputFormat === 'plaintext' && footnotes == null;
		if (includeFootnotesInText) {
			footnotes = new Map<number, string>();
		}

		const tokenMapping = new Map<string, string>();

		for (const ref of this._references) {
			if (this.ensureAutolinkCached(ref)) {
				if (ref.tokenize != null) {
					text = ref.tokenize(text, outputFormat, tokenMapping, issuesOrPullRequests, footnotes);
				}
			}
		}

		if (remotes != null && remotes.length !== 0) {
			for (const r of remotes) {
				if (r.provider == null) continue;

				for (const ref of r.provider.autolinks) {
					if (this.ensureAutolinkCached(ref)) {
						if (ref.tokenize != null) {
							text = ref.tokenize(text, outputFormat, tokenMapping, issuesOrPullRequests, footnotes);
						}
					}
				}
			}
		}

		if (tokenMapping.size !== 0) {
			// eslint-disable-next-line no-control-regex
			text = text.replace(/(\x00\d+\x00)/g, (_, t: string) => tokenMapping.get(t) ?? t);
		}

		if (includeFootnotesInText && footnotes?.size) {
			text += `\n${GlyphChars.Dash.repeat(2)}\n${join(
				map(footnotes, ([i, footnote]) => `${getSuperscript(i)} ${footnote}`),
				'\n',
			)}`;
		}

		return text;
	}

	private ensureAutolinkCached(
		ref: CacheableAutolinkReference | DynamicAutolinkReference,
	): ref is CacheableAutolinkReference | DynamicAutolinkReference {
		if (isDynamic(ref)) return true;
		if (!ref.prefix || !ref.url) return false;
		if (ref.tokenize !== undefined || ref.tokenize === null) return true;

		try {
			ref.tokenize = (
				text: string,
				outputFormat: 'html' | 'markdown' | 'plaintext',
				tokenMapping: Map<string, string>,
				issuesOrPullRequests?: Map<string, IssueOrPullRequest | PromiseCancelledError | undefined>,
				footnotes?: Map<number, string>,
			) => {
				let footnoteIndex: number;

				switch (outputFormat) {
					case 'markdown':
						ensureCachedRegex(ref, outputFormat);
						return text.replace(ref.messageMarkdownRegex, (_: string, linkText: string, num: string) => {
							const url = encodeUrl(ref.url.replace(numRegex, num));

							let title = '';
							if (ref.title) {
								title = ` "${ref.title.replace(numRegex, num)}`;

								const issue = issuesOrPullRequests?.get(num);
								if (issue != null) {
									if (issue instanceof PromiseCancelledError) {
										title += `\n${GlyphChars.Dash.repeat(2)}\nDetails timed out`;
									} else {
										const issueTitle = escapeMarkdown(issue.title.trim());

										if (footnotes != null) {
											footnoteIndex = footnotes.size + 1;
											footnotes.set(
												footnoteIndex,
												`[${getIssueOrPullRequestMarkdownIcon(
													issue,
												)} **${issueTitle}**](${url}${title}")\\\n${GlyphChars.Space.repeat(
													5,
												)}${linkText} ${issue.closed ? 'closed' : 'opened'} ${fromNow(
													issue.closedDate ?? issue.date,
												)}`,
											);
										}

										title += `\n${GlyphChars.Dash.repeat(2)}\n${issueTitle}\n${
											issue.closed ? 'Closed' : 'Opened'
										}, ${fromNow(issue.closedDate ?? issue.date)}`;
									}
								}
								title += '"';
							}

							const token = `\x00${tokenMapping.size}\x00`;
							tokenMapping.set(token, `[${linkText}](${url}${title})`);
							return token;
						});

					case 'html':
						ensureCachedRegex(ref, outputFormat);
						return text.replace(ref.messageHtmlRegex, (_: string, linkText: string, num: string) => {
							const url = encodeUrl(ref.url.replace(numRegex, num));

							let title = '';
							if (ref.title) {
								title = `"${encodeHtmlWeak(ref.title.replace(numRegex, num))}`;

								const issue = issuesOrPullRequests?.get(num);
								if (issue != null) {
									if (issue instanceof PromiseCancelledError) {
										title += `\n${GlyphChars.Dash.repeat(2)}\nDetails timed out`;
									} else {
										const issueTitle = encodeHtmlWeak(issue.title.trim());

										if (footnotes != null) {
											footnoteIndex = footnotes.size + 1;
											footnotes.set(
												footnoteIndex,
												`<a href="${url}" title=${title}>${getIssueOrPullRequestHtmlIcon(
													issue,
												)} <b>${issueTitle}</b></a><br /><span>${GlyphChars.Space.repeat(
													5,
												)}${linkText} ${issue.closed ? 'closed' : 'opened'} ${fromNow(
													issue.closedDate ?? issue.date,
												)}</span>`,
											);
										}

										title += `\n${GlyphChars.Dash.repeat(2)}\n${issueTitle}\n${
											issue.closed ? 'Closed' : 'Opened'
										}, ${fromNow(issue.closedDate ?? issue.date)}`;
									}
								}
								title += '"';
							}

							const token = `\x00${tokenMapping.size}\x00`;
							tokenMapping.set(token, `<a href="${url}" title=${title}>${linkText}</a>`);
							return token;
						});

					default:
						ensureCachedRegex(ref, outputFormat);
						return text.replace(ref.messageRegex, (_: string, linkText: string, num: string) => {
							const issue = issuesOrPullRequests?.get(num);
							if (issue == null) return linkText;

							if (footnotes != null) {
								footnoteIndex = footnotes.size + 1;
								footnotes.set(
									footnoteIndex,
									`${linkText}: ${
										issue instanceof PromiseCancelledError
											? 'Details timed out'
											: `${issue.title}  ${GlyphChars.Dot}  ${
													issue.closed ? 'Closed' : 'Opened'
											  }, ${fromNow(issue.closedDate ?? issue.date)}`
									}`,
								);
							}

							const token = `\x00${tokenMapping.size}\x00`;
							tokenMapping.set(token, `${linkText}${getSuperscript(footnoteIndex)}`);
							return token;
						});
				}
			};
		} catch (ex) {
			Logger.error(
				ex,
				`Failed to create autolink generator: prefix=${ref.prefix}, url=${ref.url}, title=${ref.title}`,
			);
			ref.tokenize = null;
		}

		return true;
	}
}

function ensureCachedRegex(
	ref: CacheableAutolinkReference,
	outputFormat: 'html',
): asserts ref is RequireSome<CacheableAutolinkReference, 'messageHtmlRegex'>;
function ensureCachedRegex(
	ref: CacheableAutolinkReference,
	outputFormat: 'markdown',
): asserts ref is RequireSome<CacheableAutolinkReference, 'messageMarkdownRegex'>;
function ensureCachedRegex(
	ref: CacheableAutolinkReference,
	outputFormat: 'plaintext',
): asserts ref is RequireSome<CacheableAutolinkReference, 'messageRegex'>;
function ensureCachedRegex(ref: CacheableAutolinkReference, outputFormat: 'html' | 'markdown' | 'plaintext') {
	// Regexes matches the ref prefix followed by a token (e.g. #1234)
	if (outputFormat === 'markdown' && ref.messageMarkdownRegex == null) {
		// Extra `\\\\` in `\\\\\\[` is because the markdown is escaped
		ref.messageMarkdownRegex = new RegExp(
			`(?<=^|\\s|\\(|\\[|\\{)(${escapeRegex(encodeHtmlWeak(escapeMarkdown(ref.prefix)))}(${
				ref.alphanumeric ? '\\w' : '\\d'
			}+))\\b`,
			ref.ignoreCase ? 'gi' : 'g',
		);
	} else if (outputFormat === 'html' && ref.messageHtmlRegex == null) {
		ref.messageHtmlRegex = new RegExp(
			`(?<=^|\\s|\\(|\\[|\\{)(${escapeRegex(encodeHtmlWeak(ref.prefix))}(${
				ref.alphanumeric ? '\\w' : '\\d'
			}+))\\b`,
			ref.ignoreCase ? 'gi' : 'g',
		);
	} else if (ref.messageRegex == null) {
		ref.messageRegex = new RegExp(
			`(?<=^|\\s|\\(|\\[|\\{)(${escapeRegex(ref.prefix)}(${ref.alphanumeric ? '\\w' : '\\d'}+))\\b`,
			ref.ignoreCase ? 'gi' : 'g',
		);
	}

	return true;
}
