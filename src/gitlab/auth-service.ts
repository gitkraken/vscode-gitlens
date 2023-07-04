import assert from 'assert';
import { window } from 'vscode';
import { CustomRemoteType, RemotesConfig } from '../config';
import { configuration } from '../configuration';
import { Container } from '../container';
import { debug } from '../system/decorators/log';

const GitLabComUrl = 'https://www.gitlab.com';

export class GitLabAuthService {
	private get glTokenMap() {
		assert(Container.context);
		return Container.context.globalState.get<Record<string, string>>('glTokens', {});
	}

	currentInstanceUrl(): string {
		const remotes: RemotesConfig[] | null = configuration.get('remotes');
		const remote = remotes?.find(remote => remote.type === CustomRemoteType.GitLab);
		return remote?.domain ? `${remote?.protocol}://${remote?.domain}` : GitLabComUrl;
	}

	@debug()
	getInstanceUrls() {
		return Object.keys(this.glTokenMap);
	}

	@debug()
	getToken(instanceUrl: string = this.currentInstanceUrl()) {
		return this.glTokenMap[instanceUrl];
	}

	@debug()
	async setToken(instanceUrl: string, token: string | undefined) {
		assert(Container.context);
		const tokenMap = this.glTokenMap;

		if (token) {
			tokenMap[instanceUrl] = token;
		} else {
			delete tokenMap[instanceUrl];
		}

		await Container.context.globalState.update('glTokens', tokenMap);
	}
	@debug()
	async askForToken() {
		if (!this.getToken() && !Container.context.workspaceState.get<boolean>('askedForToken')) {
			const message = 'GitLab Workflow: Please set GitLab Personal Access Token to setup this extension.';
			const setButton = { title: 'Set Token Now', action: 'set' };
			const readMore = { title: 'Read More', action: 'more' };

			await Container.context.workspaceState.update('askedForToken', true);
			const item = await window.showInformationMessage(message, readMore, setButton);
			if (item != null) {
				const { action } = item;

				if (action === 'set') {
					return this.showInput();
				}
				//TODO: add docs for setting up gitlab connection
				// } else {
				// commands.executeCommand(VS_COMMANDS.OPEN, Uri.parse('https://gitlab.com/gitlab-org/gitlab-vscode-extension#setup'));
				// }
			}
		}
		return Promise.resolve(this.getToken());
	}

	@debug()
	async showInput() {
		const instance = await window.showInputBox({
			ignoreFocusOut: true,
			value: GitLabComUrl,
			placeHolder: `E.g. ${GitLabComUrl}`,
			prompt: 'URL to Gitlab instance',
		});

		const token = await window.showInputBox({
			ignoreFocusOut: true,
			password: true,
			placeHolder: 'Paste your GitLab Personal Access Token...',
		});

		if (instance && token) {
			await this.setToken(instance, token);
		}
	}
}

export const gitLabAuthService: GitLabAuthService = new GitLabAuthService();
