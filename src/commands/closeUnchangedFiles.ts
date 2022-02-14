import { TextEditor, Uri, window } from 'vscode';
import { TextEditorComparer, UriComparer } from '../comparers';
import { Commands, CoreCommands } from '../constants';
import type { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { RepositoryPicker } from '../quickpicks/repositoryPicker';
import { command, executeCoreCommand } from '../system/command';
import { debounce } from '../system/function';
import { Command } from './base';

export interface CloseUnchangedFilesCommandArgs {
	uris?: Uri[];
}

@command()
export class CloseUnchangedFilesCommand extends Command {
	private _onEditorChangedFn: ((editor: TextEditor | undefined) => void) | undefined;

	constructor(private readonly container: Container) {
		super(Commands.CloseUnchangedFiles);
	}

	async execute(args?: CloseUnchangedFilesCommandArgs) {
		args = { ...args };

		try {
			if (args.uris == null) {
				const repository = await RepositoryPicker.getRepositoryOrShow('Close All Unchanged Files');
				if (repository == null) return;

				const status = await this.container.git.getStatusForRepo(repository.uri);
				if (status == null) {
					void window.showWarningMessage('Unable to close unchanged files');

					return;
				}

				args.uris = status.files.map(f => f.uri);
			}

			if (args.uris.length === 0) {
				void executeCoreCommand(CoreCommands.CloseAllEditors);

				return;
			}

			const disposable = window.onDidChangeActiveTextEditor(
				debounce((e: TextEditor | undefined) => this._onEditorChangedFn?.(e), 50),
			);

			let editor = window.activeTextEditor;

			let count = 0;
			let loopCount = 0;
			const editors: TextEditor[] = [];

			// Find out how many editors there are
			while (true) {
				if (editor != null) {
					let found = false;
					for (const e of editors) {
						if (TextEditorComparer.equals(e, editor, { usePosition: true })) {
							found = true;
							break;
						}
					}
					if (found) break;

					// Start counting at the first real editor
					count++;
					editors.push(editor);
				} else if (count !== 0) {
					count++;
				}

				editor = await this.nextEditor();

				loopCount++;
				// Break out if we've looped 4 times and haven't found any editors
				if (loopCount >= 4 && editors.length === 0) break;
			}

			if (editors.length) {
				editor = window.activeTextEditor;

				for (let i = 0; i <= count; i++) {
					if (
						editor == null ||
						editor.document.isDirty ||
						// eslint-disable-next-line no-loop-func
						args.uris.some(uri => UriComparer.equals(uri, editor?.document.uri))
					) {
						editor = await this.nextEditor();
					} else {
						editor = await this.closeEditor();
					}
				}
			}

			disposable.dispose();
		} catch (ex) {
			Logger.error(ex, 'CloseUnchangedFilesCommand');
			void Messages.showGenericErrorMessage('Unable to close all unchanged files');
		}
	}

	private async closeEditor(timeout: number = 500): Promise<TextEditor | undefined> {
		const editor = window.activeTextEditor;

		void (await executeCoreCommand(CoreCommands.CloseActiveEditor));

		if (editor !== window.activeTextEditor) {
			return window.activeTextEditor;
		}

		return this.waitForEditorChange(timeout);
	}

	private async nextEditor(timeout: number = 500): Promise<TextEditor | undefined> {
		const editor = window.activeTextEditor;

		void (await executeCoreCommand(CoreCommands.NextEditor));

		if (editor !== window.activeTextEditor) {
			return window.activeTextEditor;
		}

		return this.waitForEditorChange(timeout);
	}

	private waitForEditorChange(timeout: number = 500): Promise<TextEditor | undefined> {
		return new Promise<TextEditor | undefined>(resolve => {
			let timer: ReturnType<typeof setTimeout> | undefined;

			this._onEditorChangedFn = (editor: TextEditor | undefined) => {
				if (timer != null) {
					clearTimeout(timer);
					timer = undefined;

					resolve(editor);
				}
			};

			timer = setTimeout(() => {
				timer = undefined;

				resolve(window.activeTextEditor);
			}, timeout);
		});
	}
}
