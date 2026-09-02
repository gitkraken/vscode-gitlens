// This package's CSS exports are compiled from Sass here — tsdown has no Sass step of its own.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileString } from 'sass-embedded';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const [engineTheme, hostNeutralTheme, vscodeTheme] = await Promise.all([
	readFile(join(packageRoot, '..', 'commit-graph', 'src', 'theme.css'), 'utf8'),
	readFile(join(packageRoot, 'src', 'tokens.css'), 'utf8'),
	readFile(join(packageRoot, 'src', 'themes', 'vscode.css'), 'utf8'),
]);
const [surfaceStyles, stickyTimelineStyles, scrollMarkerStyles] = await Promise.all([
	readFile(join(packageRoot, 'src', 'graph.scss'), 'utf8'),
	readFile(join(packageRoot, 'src', 'extensions', 'stickyTimeline.scss'), 'utf8'),
	readFile(join(packageRoot, 'src', 'extensions', 'scrollMarkers.scss'), 'utf8'),
]);
const compiledStyles = compileString(`${engineTheme}\n${hostNeutralTheme}\n${surfaceStyles}`, {
	style: 'compressed',
}).css;
const compiledVscodeTheme = compileString(vscodeTheme, { style: 'compressed' }).css;
const compiledStickyTimelineStyles = compileString(stickyTimelineStyles, { style: 'compressed' }).css;
const compiledScrollMarkerStyles = compileString(scrollMarkerStyles, { style: 'compressed' }).css;

await mkdir(join(packageRoot, 'dist', 'themes'), { recursive: true });
await mkdir(join(packageRoot, 'dist', 'extensions'), { recursive: true });
await Promise.all([
	writeFile(join(packageRoot, 'dist', 'graph.css'), `${compiledStyles}\n`),
	writeFile(join(packageRoot, 'dist', 'themes', 'vscode.css'), `${compiledVscodeTheme}\n`),
	writeFile(join(packageRoot, 'dist', 'extensions', 'stickyTimeline.css'), `${compiledStickyTimelineStyles}\n`),
	writeFile(join(packageRoot, 'dist', 'extensions', 'scrollMarkers.css'), `${compiledScrollMarkerStyles}\n`),
]);
