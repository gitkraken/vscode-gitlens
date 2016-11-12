'use strict';
import { TextDocument, TextEditor, Uri } from 'vscode';

abstract class Comparer<T> {
    abstract equals(lhs: T, rhs: T): boolean;
}

class UriComparer extends Comparer<Uri> {
    equals(lhs: Uri, rhs: Uri) {
        if (!lhs && !rhs) return true;
        if ((lhs && !rhs) || (!lhs && rhs)) return false;

        return lhs.scheme === rhs.scheme && lhs.fsPath === rhs.fsPath;
    }
}

class TextDocumentComparer extends Comparer<TextDocument> {
    equals(lhs: TextDocument, rhs: TextDocument) {
        if (!lhs && !rhs) return true;
        if ((lhs && !rhs) || (!lhs && rhs)) return false;

        return uriComparer.equals(lhs.uri, rhs.uri);
    }
}

class TextEditorComparer extends Comparer<TextEditor> {
    equals(lhs: TextEditor, rhs: TextEditor) {
        if (!lhs && !rhs) return true;
        if ((lhs && !rhs) || (!lhs && rhs)) return false;

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
