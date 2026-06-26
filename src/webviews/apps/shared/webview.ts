// Entry for the shared webview foundation chunk. Its only job is to pull in webview.scss so webpack
// emits a single webview.css that every webview links (see getHtmlPlugin chunks in webpack.config.mjs).
import './webview.scss';
