'use strict';
import { TextDocument, TextEditor, Uri } from 'vscode';

abstract class Comparer<T> {
    abstract equals(lhs: T, rhs: T): boolean;
}

class UriComparer extends Comparer<Uri> {

    equals(lhs: Uri | undefined, rhs: Uri | undefined) {
        if (lhs === undefined && rhs === undefined) return true;
        if (lhs === undefined || rhs === undefined) return false;

        return lhs.scheme === rhs.scheme && lhs.fsPath === rhs.fsPath;
    }
}

class TextDocumentComparer extends Comparer<TextDocument> {

    equals(lhs: TextDocument | undefined, rhs: TextDocument | undefined) {
        if (lhs === undefined && rhs === undefined) return true;
        if (lhs === undefined || rhs === undefined) return false;

        return uriComparer.equals(lhs.uri, rhs.uri);
    }
}

class TextEditorComparer extends Comparer<TextEditor> {

    equals(lhs: TextEditor | undefined, rhs: TextEditor | undefined, options: { useId: boolean, usePosition: boolean } = { useId: false, usePosition: false }) {
        if (lhs === undefined && rhs === undefined) return true;
        if (lhs === undefined || rhs === undefined) return false;

        if (options.usePosition && (lhs.viewColumn !== rhs.viewColumn)) return false;

        if (options.useId && (!lhs.document || !rhs.document)) {
            if ((lhs as any)._id !== (rhs as any)._id) return false;

            return true;
        }

        return textDocumentComparer.equals(lhs.document, rhs.document);
    }
}

const textDocumentComparer = new TextDocumentComparer();
const textEditorComparer = new TextEditorComparer();
const uriComparer = new UriComparer();
export {
    textDocumentComparer as TextDocumentComparer,
    textEditorComparer as TextEditorComparer,
    uriComparer as UriComparer
};
