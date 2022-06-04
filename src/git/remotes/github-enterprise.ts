import { GitHubRemote } from './github';

const authProvider = Object.freeze({ id: 'github-enterprise', scopes: ['repo', 'read:user', 'user:email'] });

export class GithubEnterpriseRemote extends GitHubRemote {
	protected override get authProvider(): { id: string; scopes: string[] } {
		return authProvider;
	}

	constructor(domain: string, path: string, protocol?: string, name?: string, custom: boolean = false) {
		super(domain, path, protocol, name, custom);
	}

	override get id() {
		return 'github-enterprise';
	}

	override get name() {
		return this.formatName('GitHub Enterprise');
	}
}
