import type { TextEditor, TextEditorEdit, Uri } from 'vscode';
import { window } from 'vscode';
import type { AnnotationContext } from '../annotations/annotationProvider';
import type { ChangesAnnotationContext } from '../annotations/gutterChangesAnnotationProvider';
import { Commands } from '../constants';
import type { Container } from '../container';
import { showGenericErrorMessage } from '../messages';
import { command } from '../system/command';
import { UriComparer } from '../system/comparers';
import { Logger } from '../system/logger';
import { isTextEditor } from '../system/utils';
import { ActiveEditorCommand, EditorCommand } from './base';

@command()
export class ClearFileAnnotationsCommand extends EditorCommand {
	constructor(private readonly container: Container) {
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
			await this.container.fileAnnotations.clear(editor);
		} catch (ex) {
			Logger.error(ex, 'ClearFileAnnotationsCommand');
			void showGenericErrorMessage('Unable to clear file annotations');
		}
	}
}

export interface ToggleFileBlameAnnotationCommandArgs {
	type: 'blame';
	context?: AnnotationContext;
	on?: boolean;
}

export interface ToggleFileChangesAnnotationCommandArgs {
	type: 'changes';
	context?: ChangesAnnotationContext;
	on?: boolean;
}

export interface ToggleFileHeatmapAnnotationCommandArgs {
	type: 'heatmap';
	context?: AnnotationContext;
	on?: boolean;
}

export type ToggleFileAnnotationCommandArgs =
	| ToggleFileBlameAnnotationCommandArgs
	| ToggleFileChangesAnnotationCommandArgs
	| ToggleFileHeatmapAnnotationCommandArgs;

@command()
export class ToggleFileBlameCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([Commands.ToggleFileBlame, Commands.ToggleFileBlameInDiffLeft, Commands.ToggleFileBlameInDiffRight]);
	}

	execute(editor: TextEditor, uri?: Uri, args?: ToggleFileBlameAnnotationCommandArgs): Promise<void> {
		return toggleFileAnnotations<ToggleFileBlameAnnotationCommandArgs>(this.container, editor, uri, {
			...args,
			type: 'blame',
		});
	}
}

@command()
export class ToggleFileChangesCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(Commands.ToggleFileChanges);
	}

	execute(editor: TextEditor, uri?: Uri, args?: ToggleFileChangesAnnotationCommandArgs): Promise<void> {
		return toggleFileAnnotations<ToggleFileChangesAnnotationCommandArgs>(this.container, editor, uri, {
			...args,
			type: 'changes',
		});
	}
}

@command()
export class ToggleFileHeatmapCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super([
			Commands.ToggleFileHeatmap,
			Commands.ToggleFileHeatmapInDiffLeft,
			Commands.ToggleFileHeatmapInDiffRight,
		]);
	}

	execute(editor: TextEditor, uri?: Uri, args?: ToggleFileHeatmapAnnotationCommandArgs): Promise<void> {
		return toggleFileAnnotations<ToggleFileHeatmapAnnotationCommandArgs>(this.container, editor, uri, {
			...args,
			type: 'heatmap',
		});
	}
}

async function toggleFileAnnotations<TArgs extends ToggleFileAnnotationCommandArgs>(
	container: Container,
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
		args = { type: 'blame', ...(args as any) };

		void (await container.fileAnnotations.toggle(
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
		void showGenericErrorMessage(`Unable to toggle file ${args.type} annotations`);
	}
}
