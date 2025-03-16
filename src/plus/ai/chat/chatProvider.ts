import { Disposable } from 'vscode';
import type { Container } from '../../../container';
import { GlChatParticipant } from './chatParticipant';

export class ChatProvider implements Disposable {
	private readonly _disposable: Disposable;
	private readonly _participant: GlChatParticipant;

	constructor(private readonly container: Container) {
		this._participant = new GlChatParticipant(container);
		this._disposable = Disposable.from(this._participant);
	}

	dispose(): void {
		this._disposable.dispose();
	}
}
