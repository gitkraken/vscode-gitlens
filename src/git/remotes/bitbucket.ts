'use strict';
import { Range } from 'vscode';
import { RemoteProvider } from './provider';
import { AutolinkReference } from '../../config';
import { DynamicAutolinkReference } from '../../annotations/autolinks';

export class BitbucketRemote extends RemoteProvider {
	constructor(domain: string, path: string, protocol?: string, name?: string, custom: boolean = false) {
		super(domain, path, protocol, name, custom);
	}

	private _autolinks: (AutolinkReference | DynamicAutolinkReference)[] | undefined;
	get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		if (this._autolinks === undefined) {
			this._autolinks = [
				{
					prefix: 'issue #',
					url: `${this.baseUrl}/issues/<num>`,
					title: 'Open Issue #<num>'
				},
				{
					prefix: 'pull request #',
					url: `${this.baseUrl}/pull-requests/<num>`,
					title: 'Open PR #<num>'
				}
			];
		}
		return this._autolinks;
	}

	get icon() {
		return 'bitbucket';
	}

	get name() {
		return this.formatName('Bitbucket');
	}

	protected getUrlForBranches(): string {
		return `${this.baseUrl}/branches`;
	}

	protected getUrlForBranch(branch: string): string {
		return `${this.baseUrl}/commits/branch/${branch}`;
	}

	protected getUrlForCommit(sha: string): string {
		return `${this.baseUrl}/commits/${sha}`;
	}

	protected getUrlForFile(fileName: string, branch?: string, sha?: string, range?: Range): string {
		let line;
		if (range) {
			if (range.start.line === range.end.line) {
				line = `#${fileName}-${range.start.line}`;
			} else {
				line = `#${fileName}-${range.start.line}:${range.end.line}`;
			}
		} else {
			line = '';
		}

		if (sha) return `${this.baseUrl}/src/${sha}/${fileName}${line}`;
		if (branch) return `${this.baseUrl}/src/${branch}/${fileName}${line}`;
		return `${this.baseUrl}?path=${fileName}${line}`;
	}
}
