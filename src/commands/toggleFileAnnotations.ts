'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { ActiveEditorCommand, command, Commands, EditorCommand } from './common';
import { UriComparer } from '../comparers';
import { FileAnnotationType } from '../configuration';
import { isTextEditor } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';

@command()
export class ClearFileAnnotationsCommand extends EditorCommand {
	constructor() {
		super([Commands.ClearFileAnnotations, Commands.ComputingFileAnnotations]);
	}

	async execute(editor: TextEditor, edit: TextEditorEdit, uri?: Uri): Promise<void> {
		// Handle the case where we are focused on a non-editor editor (output, debug console)
		if (editor != null && !isTextEditor(editor)) {
			if (uri != null && !UriComparer.equals(uri, editor.document.uri)) {
				const e = window.visibleTextEditors.find(e => UriComparer.equals(uri, e.document.uri));
				if (e != null) {
					editor = e;
				}
			}
		}

		try {
			void (await Container.fileAnnotations.clear(editor));
		} catch (ex) {
			Logger.error(ex, 'ClearFileAnnotationsCommand');
			Messages.showGenericErrorMessage('Unable to clear file annotations');
		}
	}
}

export interface ToggleFileAnnotationCommandArgs {
	on?: boolean;
	sha?: string;
	type?: FileAnnotationType;
}

@command()
export class ToggleFileBlameCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.ToggleFileBlame);
	}

	execute(editor: TextEditor, uri?: Uri, args?: ToggleFileAnnotationCommandArgs): Promise<void> {
		return toggleFileAnnotations(editor, uri, {
			...args,
			type: FileAnnotationType.Blame,
		});
	}
}

@command()
export class ToggleFileHeatmapCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.ToggleFileHeatmap);
	}

	execute(editor: TextEditor, uri?: Uri, args?: ToggleFileAnnotationCommandArgs): Promise<void> {
		return toggleFileAnnotations(editor, uri, {
			...args,
			type: FileAnnotationType.Heatmap,
		});
	}
}

@command()
export class ToggleFileRecentChangesCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.ToggleFileRecentChanges);
	}

	execute(editor: TextEditor, uri?: Uri, args?: ToggleFileAnnotationCommandArgs): Promise<void> {
		return toggleFileAnnotations(editor, uri, {
			...args,
			type: FileAnnotationType.RecentChanges,
		});
	}
}

async function toggleFileAnnotations(
	editor: TextEditor,
	uri: Uri | undefined,
	args: ToggleFileAnnotationCommandArgs,
): Promise<void> {
	// Handle the case where we are focused on a non-editor editor (output, debug console)
	if (editor != null && !isTextEditor(editor)) {
		if (uri != null && !UriComparer.equals(uri, editor.document.uri)) {
			const e = window.visibleTextEditors.find(e => UriComparer.equals(uri, e.document.uri));
			if (e != null) {
				editor = e;
			}
		}
	}

	try {
		if (args.type == null) {
			args = { ...args, type: FileAnnotationType.Blame };
		}

		void (await Container.fileAnnotations.toggle(
			editor,
			args.type!,
			args.sha ?? editor?.selection.active.line,
			args.on,
		));
	} catch (ex) {
		Logger.error(ex, 'ToggleFileAnnotationsCommand');
		window.showErrorMessage(`Unable to toggle file ${args.type} annotations. See output channel for more details`);
	}
}
