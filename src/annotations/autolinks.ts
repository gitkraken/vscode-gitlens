'use strict';
import { ConfigurationChangeEvent, Disposable } from 'vscode';
import { AutolinkReference, configuration } from '../configuration';
import { Container } from '../container';
import { Strings } from '../system';
import { Logger } from '../logger';
import { GitRemote } from '../git/git';

const numRegex = /<num>/g;

export interface DynamicAutolinkReference {
	linkify: (text: string) => string;
}

function requiresGenerator(ref: AutolinkReference | DynamicAutolinkReference): ref is AutolinkReference {
	return ref.linkify === undefined;
}

export class Autolinks implements Disposable {
	protected _disposable: Disposable | undefined;
	private _references: AutolinkReference[] = [];

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

	linkify(text: string, remotes?: GitRemote[]) {
		for (const ref of this._references) {
			if (requiresGenerator(ref)) {
				ref.linkify = this._getAutolinkGenerator(ref);
			}

			if (ref.linkify != null) {
				text = ref.linkify(text);
			}
		}

		if (remotes !== undefined) {
			for (const r of remotes) {
				if (r.provider === undefined) continue;

				for (const ref of this._references) {
					if (requiresGenerator(ref)) {
						ref.linkify = this._getAutolinkGenerator(ref);
					}

					if (ref.linkify != null) {
						text = ref.linkify(text);
					}
				}
			}
		}

		return text;
	}

	private _getAutolinkGenerator({ prefix, url, title }: AutolinkReference) {
		try {
			const regex = new RegExp(
				`(?<=^|\\s)(${Strings.escapeMarkdown(prefix).replace(/\\/g, '\\\\')}([0-9]+))\\b`,
				'g'
			);
			const markdown = `[$1](${url.replace(numRegex, '$2')}${
				title ? ` "${title.replace(numRegex, '$2')}"` : ''
			})`;
			return (text: string) => text.replace(regex, markdown);
		} catch (ex) {
			Logger.error(ex, `Failed to create autolink generator: prefix=${prefix}, url=${url}, title=${title}`);
			return null;
		}
	}
}
