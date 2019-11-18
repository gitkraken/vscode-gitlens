'use strict';
import { Range } from 'vscode';
import { RemoteProvider } from './provider';
import { AutolinkReference } from '../../config';
import { DynamicAutolinkReference } from '../../annotations/autolinks';

const issueEnricher3rdParyRegex = /\b(\w+\\?-?\w+(?!\\?-)\/\w+\\?-?\w+(?!\\?-))\\?#([0-9]+)\b/g;

export class GitHubRemote extends RemoteProvider {
	constructor(domain: string, path: string, protocol?: string, name?: string, custom: boolean = false) {
		super(domain, path, protocol, name, custom);
	}

	private _autolinks: (AutolinkReference | DynamicAutolinkReference)[] | undefined;
	get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		if (this._autolinks === undefined) {
			this._autolinks = [
				{
					prefix: '#',
					url: `${this.baseUrl}/issues/<num>`,
					title: 'Open Issue #<num>'
				},
				{
					prefix: 'gh-',
					url: `${this.baseUrl}/issues/<num>`,
					title: 'Open Issue #<num>',
					ignoreCase: true
				},
				{
					linkify: (text: string) =>
						text.replace(
							issueEnricher3rdParyRegex,
							`[$&](${this.protocol}://${this.domain}/$1/issues/$2 "Open Issue #$2 from $1")`
						)
				}
			];
		}
		return this._autolinks;
	}

	get icon() {
		return 'github';
	}

	get name() {
		return this.formatName('GitHub');
	}

	// enrichMessage(message: string): string {
	// 	return (
	// 		message
	// 			// Matches #123 or gh-123 or GH-123
	// 			.replace(issueEnricherRegex, `$1[$2](${this.baseUrl}/issues/$3 "Open Issue $2")`)
	// 			// Matches eamodio/vscode-gitlens#123
	// 			.replace(
	// 				issueEnricher3rdParyRegex,
	// 				`[$&](${this.protocol}://${this.domain}/$1/issues/$2 "Open Issue #$2 from $1")`
	// 			)
	// 	);
	// }

	protected getUrlForBranches(): string {
		return `${this.baseUrl}/branches`;
	}

	protected getUrlForBranch(branch: string): string {
		return `${this.baseUrl}/commits/${branch}`;
	}

	protected getUrlForCommit(sha: string): string {
		return `${this.baseUrl}/commit/${sha}`;
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
		let line;
		if (range) {
			if (range.start.line === range.end.line) {
				line = `#L${range.start.line}`;
			} else {
				line = `#L${range.start.line}-L${range.end.line}`;
			}
		} else {
			line = '';
		}

		if (sha) return `${this.baseUrl}/blob/${sha}/${fileName}${line}`;
		if (branch) return `${this.baseUrl}/blob/${branch}/${fileName}${line}`;
		return `${this.baseUrl}?path=${fileName}${line}`;
	}
}
