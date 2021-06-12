'use strict';
import { TextEditor, TextEditorEdit, Uri, window } from 'vscode';
import { AnnotationContext } from '../annotations/annotationProvider';
import { ChangesAnnotationContext } from '../annotations/gutterChangesAnnotationProvider';
import { UriComparer } from '../comparers';
import { FileAnnotationType } from '../configuration';
import { isTextEditor } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, command, Commands, EditorCommand } from './common';

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
			void Messages.showGenericErrorMessage('Unable to clear file annotations');
		}
	}
}

export interface ToggleFileBlameAnnotationCommandArgs {
	type: FileAnnotationType.Blame;
	context?: AnnotationContext;
	on?: boolean;
}

export interface ToggleFileChangesAnnotationCommandArgs {
	type: FileAnnotationType.Changes;
	context?: ChangesAnnotationContext;
	on?: boolean;
}

export interface ToggleFileHeatmapAnnotationCommandArgs {
	type: FileAnnotationType.Heatmap;
	context?: AnnotationContext;
	on?: boolean;
}

export type ToggleFileAnnotationCommandArgs =
	| ToggleFileBlameAnnotationCommandArgs
	| ToggleFileChangesAnnotationCommandArgs
	| ToggleFileHeatmapAnnotationCommandArgs;

@command()
export class ToggleFileBlameCommand extends ActiveEditorCommand {
	constructor() {
		super([Commands.ToggleFileBlame, Commands.ToggleFileBlameInDiffLeft, Commands.ToggleFileBlameInDiffRight]);
	}

	execute(editor: TextEditor, uri?: Uri, args?: ToggleFileBlameAnnotationCommandArgs): Promise<void> {
		return toggleFileAnnotations<ToggleFileBlameAnnotationCommandArgs>(editor, uri, {
			...args,
			type: FileAnnotationType.Blame,
		});
	}
}

@command()
export class ToggleFileChangesCommand extends ActiveEditorCommand {
	constructor() {
		super(Commands.ToggleFileChanges);
	}

	execute(editor: TextEditor, uri?: Uri, args?: ToggleFileChangesAnnotationCommandArgs): Promise<void> {
		return toggleFileAnnotations<ToggleFileChangesAnnotationCommandArgs>(editor, uri, {
			...args,
			type: FileAnnotationType.Changes,
		});
	}
}

@command()
export class ToggleFileHeatmapCommand extends ActiveEditorCommand {
	constructor() {
		super([
			Commands.ToggleFileHeatmap,
			Commands.ToggleFileHeatmapInDiffLeft,
			Commands.ToggleFileHeatmapInDiffRight,
		]);
	}

	execute(editor: TextEditor, uri?: Uri, args?: ToggleFileHeatmapAnnotationCommandArgs): Promise<void> {
		return toggleFileAnnotations<ToggleFileHeatmapAnnotationCommandArgs>(editor, uri, {
			...args,
			type: FileAnnotationType.Heatmap,
		});
	}
}

async function toggleFileAnnotations<TArgs extends ToggleFileAnnotationCommandArgs>(
	editor: TextEditor,
	uri: Uri | undefined,
	args: TArgs,
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
		args = { type: FileAnnotationType.Blame, ...(args as any) };

		void (await Container.fileAnnotations.toggle(
			editor,
			args.type,
			{
				selection: args.context?.selection ?? { line: editor?.selection.active.line },
				...args.context,
			},
			args.on,
		));
	} catch (ex) {
		Logger.error(ex, 'ToggleFileAnnotationsCommand');
		void window.showErrorMessage(
			`Unable to toggle file ${args.type} annotations. See output channel for more details`,
		);
	}
}
