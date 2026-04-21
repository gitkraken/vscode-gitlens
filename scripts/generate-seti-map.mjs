/**
 * Generates seti-icons.ts from the VS Code Seti icon theme JSON.
 *
 * Usage: node scripts/generate-seti-map.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const themePath = resolve(
	__dirname,
	'../.vscode-test/vscode-linux-x64-1.115.0/resources/app/extensions/theme-seti/icons/vs-seti-icon-theme.json',
);
const outPath = resolve(__dirname, '../src/webviews/apps/shared/components/file-icon/seti-icons.ts');

const theme = JSON.parse(readFileSync(themePath, 'utf-8'));
const defs = theme.iconDefinitions;

const lines = [];

lines.push(`/**`);
lines.push(` * Seti icon theme mappings — auto-generated from VS Code's built-in Seti theme.`);
lines.push(` * Source: https://github.com/microsoft/vscode/tree/main/extensions/theme-seti`);
lines.push(` * License: MIT (Copyright (c) 2014 Jesse Weed, Copyright (c) 2015 Microsoft Corporation)`);
lines.push(` *`);
lines.push(` * DO NOT EDIT — regenerate with: node scripts/generate-seti-map.mjs`);
lines.push(` */`);
lines.push(``);

// Icon definitions: id -> [character, color]
lines.push(`/** Icon definition: [fontCharacter, fontColor] */`);
lines.push(`type IconDef = readonly [character: string, color: string];`);
lines.push(``);
lines.push(`const i: Record<string, IconDef> = {`);
for (const [k, v] of Object.entries(defs).sort(([a], [b]) => a.localeCompare(b))) {
	if (v.fontCharacter) {
		lines.push(`\t'${k}': ['${v.fontCharacter.replace(/\\/g, '\\\\')}', '${v.fontColor || ''}'],`);
	}
}
lines.push(`};`);
lines.push(``);

// Mapping tables
for (const [name, data] of [
	['fileNames', theme.fileNames],
	['fileExtensions', theme.fileExtensions],
	['languageIds', theme.languageIds],
]) {
	lines.push(`const ${name}: Record<string, string> = {`);
	for (const [k, v] of Object.entries(data || {}).sort(([a], [b]) => a.localeCompare(b))) {
		lines.push(`\t'${k}': '${v}',`);
	}
	lines.push(`};`);
	lines.push(``);
}

// Light overrides
const light = theme.light || {};
for (const [name, data] of [
	['lightFileNames', light.fileNames],
	['lightFileExtensions', light.fileExtensions],
	['lightLanguageIds', light.languageIds],
]) {
	lines.push(`const ${name}: Record<string, string> = {`);
	for (const [k, v] of Object.entries(data || {}).sort(([a], [b]) => a.localeCompare(b))) {
		lines.push(`\t'${k}': '${v}',`);
	}
	lines.push(`};`);
	lines.push(``);
}

// Defaults
lines.push(`const defaultFileIcon = '${theme.file || '_default'}';`);
lines.push(`const defaultFolderIcon = '${theme.folder || '_folder'}';`);
lines.push(`const defaultFolderExpandedIcon = '${theme.folderExpanded || '_folder_open'}';`);
lines.push(`const lightDefaultFileIcon = '${light.file || ''}';`);
lines.push(`const lightDefaultFolderIcon = '${light.folder || ''}';`);
lines.push(`const lightDefaultFolderExpandedIcon = '${light.folderExpanded || ''}';`);
lines.push(``);

// Extension to language ID mapping — must be before resolver functions
const langIds = Object.keys(theme.languageIds || {});
const extLangMap = {
	'.bat': 'bat',
	'.cmd': 'bat',
	'.clj': 'clojure',
	'.cljs': 'clojure',
	'.cljc': 'clojure',
	'.coffee': 'coffeescript',
	'.jsonc': 'jsonc',
	'.json': 'json',
	'.c': 'c',
	'.h': 'c',
	'.cpp': 'cpp',
	'.cc': 'cpp',
	'.cxx': 'cpp',
	'.hpp': 'cpp',
	'.cu': 'cuda-cpp',
	'.cs': 'csharp',
	'.css': 'css',
	'.dart': 'dart',
	'.dockerfile': 'dockerfile',
	'.gitignore': 'ignore',
	'.npmignore': 'ignore',
	'.fs': 'fsharp',
	'.fsx': 'fsharp',
	'.go': 'go',
	'.groovy': 'groovy',
	'.gradle': 'groovy',
	'.hbs': 'handlebars',
	'.handlebars': 'handlebars',
	'.html': 'html',
	'.htm': 'html',
	'.ini': 'ini',
	'.properties': 'properties',
	'.java': 'java',
	'.jsx': 'javascriptreact',
	'.js': 'javascript',
	'.mjs': 'javascript',
	'.cjs': 'javascript',
	'.jl': 'julia',
	'.kt': 'kotlin',
	'.kts': 'kotlin',
	'.tex': 'latex',
	'.less': 'less',
	'.lua': 'lua',
	'.mk': 'makefile',
	'.makefile': 'makefile',
	'.md': 'markdown',
	'.markdown': 'markdown',
	'.m': 'objective-c',
	'.mm': 'objective-cpp',
	'.pas': 'pascal',
	'.pl': 'perl',
	'.pm': 'perl',
	'.php': 'php',
	'.ps1': 'powershell',
	'.psm1': 'powershell',
	'.py': 'python',
	'.r': 'r',
	'.cshtml': 'razor',
	'.rb': 'ruby',
	'.rs': 'rust',
	'.scss': 'scss',
	'.sass': 'scss',
	'.shader': 'shaderlab',
	'.sh': 'shellscript',
	'.bash': 'shellscript',
	'.zsh': 'shellscript',
	'.sql': 'sql',
	'.swift': 'swift',
	'.ts': 'typescript',
	'.tsx': 'typescriptreact',
	'.vb': 'vb',
	'.xml': 'xml',
	'.xsl': 'xml',
	'.xsd': 'xml',
	'.yaml': 'yaml',
	'.yml': 'yaml',
	'.zig': 'zig',
};

lines.push(`/**`);
lines.push(` * File extension to VS Code language ID mapping.`);
lines.push(` * Covers languages referenced by the Seti theme's languageIds.`);
lines.push(` */`);
lines.push(`const extToLang: Record<string, string> = {`);
for (const [ext, lang] of Object.entries(extLangMap).sort(([a], [b]) => a.localeCompare(b))) {
	if (langIds.includes(lang)) {
		lines.push(`\t'${ext}': '${lang}',`);
	}
}
lines.push(`};`);
lines.push(``);

// Resolver
lines.push(`export interface SetiIcon {`);
lines.push(`\treadonly character: string;`);
lines.push(`\treadonly color: string;`);
lines.push(`}`);
lines.push(``);
lines.push(`/**`);
lines.push(` * Resolve a filename to a Seti icon character and color.`);
lines.push(` */`);
lines.push(`export function resolveSetiFileIcon(filename: string, isLight = false): SetiIcon | undefined {`);
lines.push(`\tconst lower = filename.toLowerCase();`);
lines.push(``);
lines.push(`\t// 1. fileNames (exact match)`);
lines.push(`\tconst nameMap = isLight ? lightFileNames : fileNames;`);
lines.push(`\tlet defId = nameMap[lower];`);
lines.push(`\tif (defId != null) return lookup(defId);`);
lines.push(``);
lines.push(`\t// 2. fileExtensions (longest compound extension first)`);
lines.push(`\tconst extMap = isLight ? lightFileExtensions : fileExtensions;`);
lines.push(`\tlet dotIndex = lower.indexOf('.');`);
lines.push(`\twhile (dotIndex !== -1 && dotIndex < lower.length - 1) {`);
lines.push(`\t\tdefId = extMap[lower.substring(dotIndex + 1)];`);
lines.push(`\t\tif (defId != null) return lookup(defId);`);
lines.push(`\t\tdotIndex = lower.indexOf('.', dotIndex + 1);`);
lines.push(`\t}`);
lines.push(``);
lines.push(`\t// 3. languageIds (via extension mapping)`);
lines.push(`\tconst langMap = isLight ? lightLanguageIds : languageIds;`);
lines.push(`\tconst lastDot = lower.lastIndexOf('.');`);
lines.push(`\tif (lastDot !== -1) {`);
lines.push(`\t\tconst langId = extToLang[lower.substring(lastDot)];`);
lines.push(`\t\tif (langId != null) {`);
lines.push(`\t\t\tdefId = langMap[langId];`);
lines.push(`\t\t\tif (defId != null) return lookup(defId);`);
lines.push(`\t\t}`);
lines.push(`\t}`);
lines.push(``);
lines.push(`\t// 4. Default`);
lines.push(`\tconst defaultId = isLight && lightDefaultFileIcon ? lightDefaultFileIcon : defaultFileIcon;`);
lines.push(`\treturn lookup(defaultId);`);
lines.push(`}`);
lines.push(``);

lines.push(`/**`);
lines.push(` * Resolve a folder icon.`);
lines.push(` */`);
lines.push(`export function resolveSetiFolderIcon(expanded: boolean, isLight = false): SetiIcon | undefined {`);
lines.push(`\tconst defId = expanded`);
lines.push(
	`\t\t? (isLight && lightDefaultFolderExpandedIcon ? lightDefaultFolderExpandedIcon : defaultFolderExpandedIcon)`,
);
lines.push(`\t\t: (isLight && lightDefaultFolderIcon ? lightDefaultFolderIcon : defaultFolderIcon);`);
lines.push(`\treturn lookup(defId);`);
lines.push(`}`);
lines.push(``);

lines.push(`function lookup(defId: string): SetiIcon | undefined {`);
lines.push(`\tconst def = i[defId];`);
lines.push(`\tif (def == null) return undefined;`);
lines.push(`\treturn { character: def[0], color: def[1] };`);
lines.push(`}`);
lines.push(``);

writeFileSync(outPath, lines.join('\n'));
console.log(`Generated ${outPath} (${lines.length} lines)`);
