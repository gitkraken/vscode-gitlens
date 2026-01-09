import { Container } from '../../container.js';
import type { CommitSelectedEvent } from '../../eventBus.js';
import type { Repository } from '../../git/models/repository.js';
import type { WebviewViewShowOptions } from '../webviewsController.js';
import type { ShowWipArgs } from './protocol.js';

export async function showInspectView(
	data: Partial<CommitSelectedEvent['data']> | ShowWipArgs,
	showOptions?: WebviewViewShowOptions,
): Promise<void> {
	return Container.instance.views.commitDetails.show(showOptions, data);
}

export async function startCodeReview(
	repository: Repository | undefined,
	source: ShowWipArgs['source'],
	showOptions?: WebviewViewShowOptions,
): Promise<void> {
	return showInspectView(
		{
			type: 'wip',
			inReview: true,
			repository: repository,
			source: source,
		} satisfies ShowWipArgs,
		showOptions,
	);
}
