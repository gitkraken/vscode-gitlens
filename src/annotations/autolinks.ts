'use strict';
import { ConfigurationChangeEvent, Disposable } from 'vscode';
import { AutolinkReference, configuration } from '../configuration';
import { Container } from '../container';
import { Dates, debug, Iterables, Promises, Strings } from '../system';
import { Logger } from '../logger';
import { GitRemote, IssueOrPullRequest } from '../git/git';
import { GlyphChars } from '../constants';

const numRegex = /<num>/g;

export interface CacheableAutolinkReference extends AutolinkReference {
	linkify?: ((text: string, markdown: boolean, footnotes?: Map<number, string>) => string) | null;
	messageMarkdownRegex?: RegExp;
	messageRegex?: RegExp;
}

export interface DynamicAutolinkReference {
	linkify: (text: string, markdown: boolean, footnotes?: Map<number, string>) => string;
}

function isDynamic(ref: AutolinkReference | DynamicAutolinkReference): ref is DynamicAutolinkReference {
	return (ref as AutolinkReference).prefix === undefined && (ref as AutolinkReference).url === undefined;
}

function isCacheable(ref: AutolinkReference | DynamicAutolinkReference): ref is CacheableAutolinkReference {
	return (ref as AutolinkReference).prefix !== undefined && (ref as AutolinkReference).url !== undefined;
}

export class Autolinks implements Disposable {
	protected _disposable: Disposable | undefined;
	private _references: CacheableAutolinkReference[] = [];

	constructor() {
		this._disposable = Disposable.from(configuration.onDidChange(this.onConfigurationChanged, this));

		this.onConfigurationChanged(configuration.initializingChangeEvent);
	}

	dispose() {
		this._disposable?.dispose();
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'autolinks')) {
			this._references = Container.config.autolinks ?? [];
		}
	}

	@debug({
		args: {
			0: (message: string) => message.substring(0, 50),
			1: _ => false,
			2: ({ timeout }) => timeout,
		},
	})
	async getIssueOrPullRequestLinks(message: string, remote: GitRemote, { timeout }: { timeout?: number } = {}) {
		if (!remote.provider?.hasApi()) return undefined;

		const { provider } = remote;
		const connected = provider.maybeConnected ?? (await provider.isConnected());
		if (!connected) return undefined;

		const ids = new Set<string>();

		let match;
		let num;
		for (const ref of provider.autolinks) {
			if (!isCacheable(ref)) continue;

			if (ref.messageRegex === undefined) {
				ref.messageRegex = new RegExp(
					`(?<=^|\\s|\\(|\\\\\\[)(${Strings.escapeRegex(ref.prefix)}([${
						ref.alphanumeric ? '\\w' : '0-9'
					}]+))\\b`,
					ref.ignoreCase ? 'gi' : 'g',
				);
			}

			do {
				match = ref.messageRegex.exec(message);
				if (match == null) break;

				[, , num] = match;

				ids.add(num);
			} while (true);
		}

		if (ids.size === 0) return undefined;

		const issuesOrPullRequests = await Promises.raceAll(
			ids.values(),
			id => provider.getIssueOrPullRequest(id),
			timeout,
		);
		if (issuesOrPullRequests.size === 0 || Iterables.every(issuesOrPullRequests.values(), pr => pr === undefined)) {
			return undefined;
		}

		return issuesOrPullRequests;
	}

	@debug({
		args: {
			0: (text: string) => text.substring(0, 30),
			2: _ => false,
			3: _ => false,
		},
	})
	linkify(
		text: string,
		markdown: boolean,
		remotes?: GitRemote[],
		issuesOrPullRequests?: Map<string, IssueOrPullRequest | Promises.CancellationError | undefined>,
		footnotes?: Map<number, string>,
	) {
		for (const ref of this._references) {
			if (this.ensureAutolinkCached(ref, issuesOrPullRequests)) {
				if (ref.linkify != null) {
					text = ref.linkify(text, markdown, footnotes);
				}
			}
		}

		if (remotes != null && remotes.length !== 0) {
			for (const r of remotes) {
				if (r.provider === undefined) continue;

				for (const ref of r.provider.autolinks) {
					if (this.ensureAutolinkCached(ref, issuesOrPullRequests)) {
						if (ref.linkify != null) {
							text = ref.linkify(text, markdown, footnotes);
						}
					}
				}
			}
		}

		return text;
	}

	private ensureAutolinkCached(
		ref: CacheableAutolinkReference | DynamicAutolinkReference,
		issuesOrPullRequests?: Map<string, IssueOrPullRequest | Promises.CancellationError | undefined>,
	): ref is CacheableAutolinkReference | DynamicAutolinkReference {
		if (isDynamic(ref)) return true;

		try {
			if (ref.messageMarkdownRegex === undefined) {
				ref.messageMarkdownRegex = new RegExp(
					`(?<=^|\\s|\\(|\\\\\\[)(${Strings.escapeRegex(Strings.escapeMarkdown(ref.prefix))}([${
						ref.alphanumeric ? '\\w' : '0-9'
					}]+))\\b`,
					ref.ignoreCase ? 'gi' : 'g',
				);
			}

			if (issuesOrPullRequests == null || issuesOrPullRequests.size === 0) {
				const replacement = `[$1](${ref.url.replace(numRegex, '$2')}${
					ref.title ? ` "${ref.title.replace(numRegex, '$2')}"` : ''
				})`;
				ref.linkify = (text: string, markdown: boolean) =>
					markdown ? text.replace(ref.messageMarkdownRegex!, replacement) : text;

				return true;
			}

			ref.linkify = (text: string, markdown: boolean, footnotes?: Map<number, string>) => {
				if (markdown) {
					return text.replace(ref.messageMarkdownRegex!, (_substring, linkText, num) => {
						const issue = issuesOrPullRequests?.get(num);

						let title = '';
						if (ref.title) {
							title = ` "${ref.title.replace(numRegex, num)}`;

							if (issue) {
								if (issue instanceof Promises.CancellationError) {
									title += `\n${GlyphChars.Dash.repeat(2)}\nDetails timed out`;
								} else {
									title += `\n${GlyphChars.Dash.repeat(2)}\n${issue.title.replace(
										/([")\\])/g,
										'\\$1',
									)}\n${issue.closed ? 'Closed' : 'Opened'}, ${Dates.getFormatter(
										issue.closedDate ?? issue.date,
									).fromNow()}`;
								}
							}
							title += '"';
						}

						return `[${linkText}](${ref.url.replace(numRegex, num)}${title})`;
					});
				}

				const includeFootnotes = footnotes == null;
				let index;

				text = text.replace(ref.messageRegex!, (_substring, linkText, num) => {
					const issue = issuesOrPullRequests?.get(num);
					if (issue == null) return linkText;

					if (footnotes === undefined) {
						footnotes = new Map<number, string>();
					}

					index = footnotes.size + 1;
					footnotes.set(
						footnotes.size + 1,
						`${linkText}: ${
							issue instanceof Promises.CancellationError
								? 'Details timed out'
								: `${issue.title}  ${GlyphChars.Dot}  ${
										issue.closed ? 'Closed' : 'Opened'
								  }, ${Dates.getFormatter(issue.closedDate ?? issue.date).fromNow()}`
						}`,
					);
					return `${linkText}${Strings.getSuperscript(index)}`;
				});

				return includeFootnotes && footnotes != null && footnotes.size !== 0
					? `${text}\n${GlyphChars.Dash.repeat(2)}\n${Iterables.join(
							Iterables.map(footnotes, ([i, footnote]) => `${Strings.getSuperscript(i)} ${footnote}`),
							'\n',
					  )}`
					: text;
			};
		} catch (ex) {
			Logger.error(
				ex,
				`Failed to create autolink generator: prefix=${ref.prefix}, url=${ref.url}, title=${ref.title}`,
			);
			ref.linkify = null;
		}

		return true;
	}
}
