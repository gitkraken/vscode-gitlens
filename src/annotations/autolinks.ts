'use strict';
import { ConfigurationChangeEvent, Disposable } from 'vscode';
import { AutolinkReference, configuration } from '../configuration';
import { Container } from '../container';
import { Dates, Strings } from '../system';
import { Logger } from '../logger';
import { GitRemote, Issue } from '../git/git';
import { RemoteProviderWithApi } from '../git/remotes/provider';
import { GlyphChars } from '../constants';

const numRegex = /<num>/g;

export interface CacheableAutolinkReference extends AutolinkReference {
	linkify?: ((text: string) => string) | null;
	markdownRegex?: RegExp;
	textRegex?: RegExp;
}

export interface DynamicAutolinkReference {
	linkify: (text: string) => string;
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

	async getIssueLinks(text: string, remotes: GitRemote[]) {
		if (remotes.length === 0) return undefined;

		const issues = new Map<number, Issue>();

		for (const r of remotes) {
			if (!(r.provider instanceof RemoteProviderWithApi)) continue;
			if (!(await r.provider.isConnected())) continue;

			for (const ref of r.provider.autolinks) {
				if (!isCacheable(ref)) continue;

				if (ref.textRegex === undefined) {
					ref.textRegex = new RegExp(`(?<=^|\\s)(${ref.prefix}([0-9]+))\\b`, 'g');
				}

				let match;
				let num;
				let id;
				let issue;
				do {
					match = ref.textRegex.exec(text);
					if (match == null) break;

					[, , num] = match;

					id = Number(num);
					issue = await r.provider.getIssue(id);
					if (issue != null) {
						issues.set(id, issue);
					}
				} while (true);
			}
		}

		if (issues.size === 0) return undefined;
		return issues;
	}

	linkify(text: string, remotes?: GitRemote[], issues?: Map<number, Issue>) {
		for (const ref of this._references) {
			if (this.ensureAutolinkCached(ref, issues)) {
				if (ref.linkify != null) {
					text = ref.linkify(text);
				}
			}
		}

		if (remotes != null && remotes.length !== 0) {
			for (const r of remotes) {
				if (r.provider === undefined) continue;

				for (const ref of r.provider.autolinks) {
					if (this.ensureAutolinkCached(ref, issues)) {
						if (ref.linkify != null) {
							text = ref.linkify(text);
						}
					}
				}
			}
		}

		return text;
	}

	private ensureAutolinkCached(
		ref: CacheableAutolinkReference | DynamicAutolinkReference,
		issues?: Map<number, Issue>
	): ref is CacheableAutolinkReference | DynamicAutolinkReference {
		if (isDynamic(ref)) return true;

		try {
			if (ref.markdownRegex === undefined) {
				ref.markdownRegex = new RegExp(
					`(?<=^|\\s)(${Strings.escapeMarkdown(ref.prefix).replace(/\\/g, '\\\\')}([0-9]+))\\b`,
					'g'
				);
			}

			if (issues == null || issues.size === 0) {
				const markdown = `[$1](${ref.url.replace(numRegex, '$2')}${
					ref.title ? ` "${ref.title.replace(numRegex, '$2')}"` : ''
				})`;
				ref.linkify = (text: string) => text.replace(ref.markdownRegex!, markdown);

				return true;
			}

			ref.linkify = (text: string) =>
				text.replace(ref.markdownRegex!, (substring, linkText, number) => {
					const issue = issues?.get(Number(number));

					return `[${linkText}](${ref.url.replace(numRegex, number)}${
						ref.title
							? ` "${ref.title.replace(numRegex, number)}${
									issue
										? `\n${GlyphChars.Dash.repeat(2)}\n${issue.title.replace(/([")])/g, '\\$1')}\n${
												issue.closed ? 'Closed' : 'Opened'
										  }, ${Dates.getFormatter(issue.closedDate ?? issue.date).fromNow()}`
										: ''
							  }"`
							: ''
					})`;
				});
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
