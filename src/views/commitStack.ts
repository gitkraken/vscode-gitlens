import type { StatusBarItem } from 'vscode';
import { MarkdownString, StatusBarAlignment, window } from 'vscode';
import type { Container } from '../container';
import type { GitBranch } from '../git/models/branch';
import type { ViewRefNode } from './nodes/viewNode';

export class CommitStack {
	private container: Container;
	// The stack which is pushed to and popped from.
	// We push and pop ViewRefNode types for convenience since these nodes
	// coorespond to commit refs in the Commit view.
	private stack: ViewRefNode[] = [];
	// A StatusBarItem is created and displayed when the stack is not empty.
	private statusBarItem?: StatusBarItem;
	// The git ref that was checked out before any commit was pushed to the stack.
	private originalRef?: GitBranch;

	constructor(container: Container) {
		this.container = container;
	}

	private renderStatusBarTooltip = (): MarkdownString => {
		const tooltip = new MarkdownString();
		if (this.originalRef) {
			tooltip.appendMarkdown(`**original ref**: ${this.originalRef.name}\n\n`);
		}
		this.stack.forEach((n: ViewRefNode, i: number) => {
			tooltip.appendMarkdown(`**${i}**. **commit**: ${n.ref.name}\n\n`);
		});
		return tooltip;
	};

	async push(commit: ViewRefNode): Promise<void> {
		if (this.stack.length == 0) {
			// track the 'ref' the branh was on before we start adding to the
			// stack, we'll restore to this ref after the stack is emptied.
			this.originalRef = await this.container.git.getBranch(commit.repoPath);
			this.statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 100);
			this.statusBarItem.show();
		}
		this.stack.push(commit);
		if (this.statusBarItem) {
			this.statusBarItem.text = `commit stack: ${commit.ref.name} ${this.stack.length}`;
			this.statusBarItem.tooltip = this.renderStatusBarTooltip();
		}
		void window.showInformationMessage(`Pushed ${commit.ref.name} onto stack`);
		return Promise.resolve();
	}

	async pop(): Promise<ViewRefNode | void> {
		if (this.stack.length == 0) {
			void window.showErrorMessage(
				"Stack is empty.\nUse 'Switch to Commit (Stacked) command to push a commit to the stack.",
			);
			return;
		}
		const node = this.stack.pop();
		// this just shuts the compiler up, it doesn't understand that pop()
		// won't return an undefined since we check length above.
		if (!node) {
			return;
		}
		void window.showInformationMessage(`Popped ${node.ref.name} from stack`);
		if (this.stack.length == 0) {
			await this.empty();
			return;
		}
		const curNode = this.stack[this.stack.length - 1];
		if (this.statusBarItem) {
			this.statusBarItem.text = `commit stack: ${curNode.ref.name} ${this.stack.length}`;
			this.statusBarItem.tooltip = this.renderStatusBarTooltip();
		}
		return curNode;
	}

	async empty(): Promise<void> {
		this.stack = [];
		this.statusBarItem?.dispose();
		this.statusBarItem = undefined;
		void window.showInformationMessage('Stack is now empty.');
		if (this.originalRef) {
			// if we stored a original 'ref' before pushing to the stack,
			// restore it.
			await this.container.git.checkout(this.originalRef.repoPath, this.originalRef.ref);
			void window.showInformationMessage(`Restored original ref to ${this.originalRef.name}`);
			this.originalRef = undefined;
		}
		return Promise.resolve();
	}
}
