/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');
const nls = require('vscode-nls-dev');
const path = require('path');
const minimist = require('minimist');
const es = require('event-stream');
const sourcemaps = require('gulp-sourcemaps');
const ts = require('gulp-typescript');
const typescript = require('typescript');
const tsProject = ts.createProject('./tsconfig.json', { typescript, rootDir: '.' });
tsProject.base = '/home/airaketa/vscode-gitlens';
const filter = require('gulp-filter');

const languages = [
	// { id: "zh-tw", folderName: "cht", transifexId: "zh-hant" },
	// { id: "zh-cn", folderName: "chs", transifexId: "zh-hans" },
	// { id: "fr", folderName: "fra" },
	// { id: "de", folderName: "deu" },
	// { id: "it", folderName: "ita" },
	// { id: "es", folderName: "esn" },
	// { id: "ja", folderName: "jpn" },
	// { id: "ko", folderName: "kor" },
	// { id: 'ru', folderName: 'rus' },
	//{ id: "bg", folderName: "bul" }, // VS Code supports Bulgarian, but VS is not currently localized for it
	//{ id: "hu", folderName: "hun" }, // VS Code supports Hungarian, but VS is not currently localized for it
	// { id: "pt-br", folderName: "ptb", transifexId: "pt-BR" },
	// { id: "tr", folderName: "trk" },
	// { id: "cs", folderName: "csy" },
	// { id: "pl", folderName: "plk" }
];

// ****************************
// Command: translations-export
// The following is used to export and XLF file containing english strings for translations.
// The result will be written to: ../vscode-extensions-localization-export/ms-vscode/
// ****************************

const translationProjectName = 'vscode-gitlens';
const translationExtensionName = 'gitlens';

// descriptionCallback(path, value, parent) is invoked for attributes
const traverseJson = (jsonTree, descriptionCallback, prefixPath) => {
	for (let fieldName in jsonTree) {
		if (jsonTree[fieldName] !== null) {
			if (
				typeof jsonTree[fieldName] == 'string' &&
				(fieldName === 'description' || fieldName === 'markdownDescription')
			) {
				descriptionCallback(prefixPath, jsonTree[fieldName], jsonTree);
			} else if (typeof jsonTree[fieldName] == 'object') {
				let path = prefixPath;
				if (path !== '') path = path + '.';
				path = path + fieldName;
				traverseJson(jsonTree[fieldName], descriptionCallback, path);
			}
		}
	}
};

gulp.task('translations-export', done => {
	// Transpile the TS to JS, and let vscode-nls-dev scan the files for calls to localize.
	tsProject
		.src()
		.pipe(sourcemaps.init())
		.pipe(tsProject())
		.js.pipe(nls.createMetaDataFiles())

		// Filter down to only the files we need
		.pipe(filter(['**/*.nls.json', '**/*.nls.metadata.json']))

		// Consoldate them into nls.metadata.json, which the xlf is built from.
		.pipe(nls.bundleMetaDataFiles('vscode.gitlens', '.'))

		// filter down to just the resulting metadata files
		.pipe(filter(['**/nls.metadata.header.json', '**/nls.metadata.json']))

		// Add package.nls.json, used to localized package.json
		.pipe(gulp.src(['package.nls.json']))

		// package.nls.json and nls.metadata.json are used to generate the xlf file
		// Does not re-queue any files to the stream.  Outputs only the XLF file
		.pipe(nls.createXlfFiles(translationProjectName, translationExtensionName))
		.pipe(gulp.dest(`${translationProjectName}-localization-export`))
		.pipe(
			es.wait(() => {
				done();
			}),
		);
});

// ****************************
// Command: translations-import
// The following is used to import an XLF file containing all language strings.
// This results in a i18n directory, which should be checked in.
// ****************************

// Imports translations from raw localized MLCP strings to VS Code .i18n.json files
gulp.task('translations-import', done => {
	let options = minimist(process.argv.slice(2), {
		string: 'location',
		default: {
			location: 'vscode-translations-import',
		},
	});
	es.merge(
		languages.map(language => {
			let id = language.transifexId || language.id;
			return gulp
				.src(path.join(options.location, id, translationProjectName, `${translationExtensionName}.xlf`))
				.pipe(nls.prepareJsonFiles())
				.pipe(gulp.dest(path.join('./i18n', language.folderName)));
		}),
	).pipe(
		es.wait(() => {
			done();
		}),
	);
});

// ****************************
// Command: translations-generate
// The following is used to import an i18n directory structure and generate files used at runtime.
// ****************************

// Generate package.nls.*.json files from: ./i18n/*/package.i18n.json
// Outputs to root path, as these nls files need to be along side package.json
const generateAdditionalLocFiles = () => {
	return gulp
		.src(['package.nls.json'])
		.pipe(nls.createAdditionalLanguageFiles(languages, 'i18n'))
		.pipe(gulp.dest('.'));
};

// Generates ./dist/nls.bundle.<language_id>.json from files in ./i18n/** *//<src_path>/<filename>.i18n.json
// Localized strings are read from these files at runtime.
const generateSrcLocBundle = () => {
	// Transpile the TS to JS, and let vscode-nls-dev scan the files for calls to localize.
	return tsProject
		.src()
		.pipe(sourcemaps.init())
		.pipe(tsProject())
		.js.pipe(nls.createMetaDataFiles())
		.pipe(nls.createAdditionalLanguageFiles(languages, 'i18n'))
		.pipe(nls.bundleMetaDataFiles('vscode-gitlens', 'dist'))
		.pipe(nls.bundleLanguageFiles())
		.pipe(filter(['**/nls.bundle.*.json', '**/nls.metadata.header.json', '**/nls.metadata.json']))
		.pipe(gulp.dest('dist'));
};

gulp.task('translations-generate', gulp.series(generateSrcLocBundle, generateAdditionalLocFiles));
