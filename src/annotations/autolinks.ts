'use strict';
import { ConfigurationChangeEvent, Disposable } from 'vscode';
import { AutolinkReference, configuration } from '../configuration';
import { Container } from '../container';
import { Dates, debug, Iterables, Promises, Strings } from '../system';
import { Logger } from '../logger';
import { GitRemote, IssueOrPullRequest } from '../git/git';
import { GlyphChars } from '../constants';

const numRegex = /<num>/g;

const superscripts = ['\u00B9', '\u00B2', '\u00B3', '\u2074', '\u2075', '\u2076', '\u2077', '\u2078', '\u2079'];

export interface CacheableAutolinkReference extends AutolinkReference {
	linkify?: ((text: string, markdown: boolean) => string) | null;
	messageMarkdownRegex?: RegExp;
	messageRegex?: RegExp;
}

export interface DynamicAutolinkReference {
	linkify: (text: string, markdown: boolean) => string;
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
		this._disposable && this._disposable.dispose();
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'autolinks')) {
			this._references = Container.config.autolinks ?? [];
		}
	}

	@debug({ args: false })
	async getIssueOrPullRequestLinks(message: string, remote: GitRemote, { timeout }: { timeout?: number } = {}) {
		if (!remote.provider?.hasApi()) return undefined;

		const { provider } = remote;
		const connected = provider.maybeConnected ?? (await provider.isConnected());
		if (!connected) return undefined;

		const ids = new Set<number>();

		let match;
		let num;
		for (const ref of provider.autolinks) {
			if (!isCacheable(ref)) continue;

			if (ref.messageRegex === undefined) {
				ref.messageRegex = new RegExp(
					`(?<=^|\\s|\\()(${ref.prefix}([${ref.alphanumeric ? '\\w' : '0-9'}]+))\\b`,
					ref.ignoreCase ? 'gi' : 'g'
				);
			}

			do {
				match = ref.messageRegex.exec(message);
				if (match == null) break;

				[, , num] = match;

				ids.add(Number(num));
			} while (true);
		}

		if (ids.size === 0) return undefined;

		const issuesOrPullRequests = await Promises.raceAll(
			ids.values(),
			id => provider.getIssueOrPullRequest(id),
			timeout
		);
		if (issuesOrPullRequests.size === 0 || Iterables.every(issuesOrPullRequests.values(), pr => pr === undefined)) {
			return undefined;
		}

		return issuesOrPullRequests;
	}

	@debug({ args: false })
	linkify(
		text: string,
		markdown: boolean,
		remotes?: GitRemote[],
		issuesOrPullRequests?: Map<number, IssueOrPullRequest | Promises.CancellationError | undefined>
	) {
		for (const ref of this._references) {
			if (this.ensureAutolinkCached(ref, issuesOrPullRequests)) {
				if (ref.linkify != null) {
					text = ref.linkify(text, markdown);
				}
			}
		}

		if (remotes != null && remotes.length !== 0) {
			for (const r of remotes) {
				if (r.provider === undefined) continue;

				for (const ref of r.provider.autolinks) {
					if (this.ensureAutolinkCached(ref, issuesOrPullRequests)) {
						if (ref.linkify != null) {
							text = ref.linkify(text, markdown);
						}
					}
				}
			}
		}

		return text;
	}

	private ensureAutolinkCached(
		ref: CacheableAutolinkReference | DynamicAutolinkReference,
		issuesOrPullRequests?: Map<number, IssueOrPullRequest | Promises.CancellationError | undefined>
	): ref is CacheableAutolinkReference | DynamicAutolinkReference {
		if (isDynamic(ref)) return true;

		try {
			if (ref.messageMarkdownRegex === undefined) {
				ref.messageMarkdownRegex = new RegExp(
					`(?<=^|\\s|\\()(${Strings.escapeMarkdown(ref.prefix).replace(/\\/g, '\\\\')}([${
						ref.alphanumeric ? '\\w' : '0-9'
					}]+))\\b`,
					ref.ignoreCase ? 'gi' : 'g'
				);
			}

			if (issuesOrPullRequests == null || issuesOrPullRequests.size === 0) {
				const replacement = `[$1](${ref.url.replace(numRegex, '$2')}${
					ref.title ? ` "${ref.title.replace(numRegex, '$2')}"` : ''
				})`;
				ref.linkify = (text: string, markdown: boolean) =>
					!markdown ? text : text.replace(ref.messageMarkdownRegex!, replacement);

				return true;
			}

			ref.linkify = (text: string, markdown: boolean) => {
				if (markdown) {
					return text.replace(ref.messageMarkdownRegex!, (substring, linkText, number) => {
						const issue = issuesOrPullRequests?.get(Number(number));

						return `[${linkText}](${ref.url.replace(numRegex, number)}${
							ref.title
								? ` "${ref.title.replace(numRegex, number)}${
										issue instanceof Promises.CancellationError
											? `\n${GlyphChars.Dash.repeat(2)}\nDetails timed out`
											: issue
											? `\n${GlyphChars.Dash.repeat(2)}\n${issue.title.replace(
													/([")])/g,
													'\\$1'
											  )}\n${issue.closed ? 'Closed' : 'Opened'}, ${Dates.getFormatter(
													issue.closedDate ?? issue.date
											  ).fromNow()}`
											: ''
								  }"`
								: ''
						})`;
					});
				}

				let footnotes: string[] | undefined;
				let superscript;

				text = text.replace(ref.messageRegex!, (substring, linkText, number) => {
					const issue = issuesOrPullRequests?.get(Number(number));
					if (issue == null) return linkText;

					if (footnotes === undefined) {
						footnotes = [];
					}
					superscript = superscripts[footnotes.length];
					footnotes.push(
						`${superscript} ${
							issue instanceof Promises.CancellationError
								? 'Details timed out'
								: issue
								? `${issue.title}  ${GlyphChars.Dot}  ${
										issue.closed ? 'Closed' : 'Opened'
								  }, ${Dates.getFormatter(issue.closedDate ?? issue.date).fromNow()}`
								: ''
						}`
					);
					return `${linkText}${superscript}`;
				});

				return footnotes == null || footnotes.length === 0 ? text : `${text}\n\n${footnotes.join('\n')}`;
			};
		} catch (ex) {
			Logger.error(
				ex,
				`Failed to create autolink generator: prefix=${ref.prefix}, url=${ref.url}, title=${ref.title}`
			);
			ref.linkify = null;
		}

		return true;
	}
}
