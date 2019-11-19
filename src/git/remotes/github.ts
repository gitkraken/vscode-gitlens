'use strict';
import { Disposable, env, QuickInputButton, Range, Uri, window } from 'vscode';
import { DynamicAutolinkReference } from '../../annotations/autolinks';
import { AutolinkReference } from '../../config';
import { Container } from '../../container';
import { PullRequest } from '../models/pullRequest';
import { RemoteProviderWithApi } from './provider';

const issueEnricher3rdParyRegex = /\b(\w+\\?-?\w+(?!\\?-)\/\w+\\?-?\w+(?!\\?-))\\?#([0-9]+)\b/g;

export class GitHubRemote extends RemoteProviderWithApi<{ token: string }> {
	private readonly Buttons = class {
		static readonly Help: QuickInputButton = {
			iconPath: {
				dark: Uri.file(Container.context.asAbsolutePath('images/dark/icon-help.svg')),
				light: Uri.file(Container.context.asAbsolutePath('images/light/icon-help.svg'))
			},
			tooltip: 'Help'
		};
	};

	constructor(domain: string, path: string, protocol?: string, name?: string, custom: boolean = false) {
		super(domain, path, protocol, name, custom);
	}

	get apiBaseUrl() {
		return this.custom ? `${this.protocol}://${this.domain}/api` : `https://api.${this.domain}`;
	}

	private _autolinks: (AutolinkReference | DynamicAutolinkReference)[] | undefined;
	get autolinks(): (AutolinkReference | DynamicAutolinkReference)[] {
		if (this._autolinks === undefined) {
			this._autolinks = [
				{
					prefix: '#',
					url: `${this.baseUrl}/issues/<num>`,
					title: `Open Issue #<num> on ${this.name}`
				},
				{
					prefix: 'gh-',
					url: `${this.baseUrl}/issues/<num>`,
					title: `Open Issue #<num> on ${this.name}`,
					ignoreCase: true
				},
				{
					linkify: (text: string) =>
						text.replace(
							issueEnricher3rdParyRegex,
							`[$&](${this.protocol}://${this.domain}/$1/issues/$2 "Open Issue #$2 from $1 on ${this.name}")`
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

	async connect() {
		const input = window.createInputBox();
		input.ignoreFocusOut = true;

		let disposable: Disposable | undefined;
		let token: string | undefined;

		try {
			token = await new Promise<string | undefined>(resolve => {
				disposable = Disposable.from(
					input.onDidHide(() => resolve(undefined)),
					input.onDidTriggerButton(e => {
						if (e === this.Buttons.Help) {
							env.openExternal(Uri.parse('https://github.com/eamodio/vscode-gitlens/wiki'));
						}
					}),
					input.onDidChangeValue(
						e =>
							(input.validationMessage =
								e == null || e.length === 0
									? 'Must be a valid GitHub personal access token'
									: undefined)
					),
					input.onDidAccept(() => resolve(input.value))
				);

				input.buttons = [this.Buttons.Help];
				input.title = `Connect to ${this.name}`;
				input.prompt = 'Enter a GitHub personal access token';
				input.placeholder = 'Generate a personal access token from github.com (required)';

				input.show();
		});
		} finally {
			input.dispose();
			disposable?.dispose();
		}

		if (token == null || token.length === 0) return;

		this.saveCredentials({ token: token });
	}

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

	protected async onGetPullRequestForCommit(
		{ token }: { token: string },
		ref: string
	): Promise<PullRequest | undefined> {
		const [owner, repo] = this.splitPath();
		return (await Container.github).getPullRequestForCommit(token, owner, repo, ref, { baseUrl: this.apiBaseUrl });
	}
}
