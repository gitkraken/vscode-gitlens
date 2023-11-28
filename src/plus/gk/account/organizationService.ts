import { Disposable, window } from 'vscode';
import type { Container } from '../../../container';
import { gate } from '../../../system/decorators/gate';
import { Logger } from '../../../system/logger';
import { getLogScope } from '../../../system/logger.scope';
import type { ServerConnection } from '../serverConnection';
import type { Organization } from './organization';
import type { SubscriptionChangeEvent } from './subscriptionService';

export class OrganizationService implements Disposable {
	private _disposable: Disposable;
	private _organizations: Organization[] | null | undefined;

	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {
		this._disposable = Disposable.from(container.subscription.onDidChange(this.onSubscriptionChanged, this));
		this._organizations = undefined;
	}

	@gate()
	async getOrganizations(): Promise<Organization[]> {
		const scope = getLogScope();
		if (this._organizations === undefined) {
			// TODO: Use organizations-light instead once available.
			const rsp = await this.connection.fetchApi('user/organizations', {
				method: 'GET',
			});

			if (!rsp.ok) {
				debugger;
				Logger.error('', scope, `Unable to get organizations; status=(${rsp.status}): ${rsp.statusText}`);

				void window.showErrorMessage(`Unable to get organizations; Status: ${rsp.statusText}`, 'OK');

				this._organizations = null;
			}

			const organizations = await rsp.json();
			this._organizations = organizations.map((o: any) => ({
				id: o.id,
				name: o.name,
				role: o.role,
			}));
		}

		return this._organizations ?? [];
	}

	dispose(): void {
		this._disposable.dispose();
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent): void {
		if (e.current?.account?.id !== e.previous?.account?.id) {
			this._organizations = undefined;
		}
	}
}
