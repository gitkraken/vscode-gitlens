// @ts-check
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.join(path.dirname(__filename), '..');

const filePath = path.join(__dirname, 'src/constants.telemetry.ts');

const program = ts.createProgram([filePath], {});
const sourceFile = program.getSourceFile(filePath);
const typeChecker = program.getTypeChecker();

if (!sourceFile) {
	throw new Error(`Could not find source file: ${filePath}`);
}

let telemetryEventsType;
let telemetryGlobalContext;

// Find the types
ts.forEachChild(sourceFile, node => {
	if (ts.isTypeAliasDeclaration(node)) {
		switch (node.name.text) {
			case 'TelemetryEvents':
				telemetryEventsType = typeChecker.getTypeAtLocation(node);
				break;
			case 'TelemetryGlobalContext':
				telemetryGlobalContext = typeChecker.getTypeAtLocation(node);
				break;
		}
	}
});

if (!telemetryEventsType || !telemetryGlobalContext) {
	throw new Error('Could not find the telemetry types');
}

// Generate markdown
let markdown = '# GitLens Telemetry\n\n';
markdown += '> This is a generated file. Do not edit.\n\n';

markdown += '## Global Attributes\n\n';
markdown += '> Global attributes are sent (if available) with every telemetry event\n\n';

markdown += `${expandType(telemetryGlobalContext, '', true, 'global.')}\n\n`;

markdown += '## Events\n\n';

const properties = typeChecker.getPropertiesOfType(telemetryEventsType);
for (const prop of properties) {
	const propType = typeChecker.getTypeOfSymbolAtLocation(prop, sourceFile);

	markdown += `### ${prop.name}\n\n`;

	// Add property documentation if available
	const propDocs = prop.getDocumentationComment(typeChecker);
	if (propDocs.length > 0) {
		markdown += `> ${propDocs.map(doc => doc.text).join('\n> ')}\n\n`;
	}

	// Check for deprecated tag
	const jsDocTags = getJSDocTags(prop);
	if (jsDocTags.deprecated) {
		markdown += `> **Deprecated:** ${
			jsDocTags.deprecated === true ? 'This property is deprecated.' : jsDocTags.deprecated
		}\n\n`;
	}

	markdown += `${expandType(propType, '')}\n\n`;
}

const outputPath = path.join(__dirname, 'docs/telemetry-events.md');
fs.writeFileSync(outputPath, markdown);

function expandType(type, indent = '', isRoot = true, prefix = '') {
	let result = '';

	if (type.isUnion()) {
		if (isRoot) {
			return type.types
				.map(t => `\`\`\`typescript\n${expandType(t, '', false, prefix)}\n\`\`\``)
				.join('\n\nor\n\n');
		} else {
			const types = type.types.map(t => expandType(t, indent, false, prefix)).join(' | ');
			result = types.includes('\n') ? `(${types})` : types;
		}
	} else if (type.isIntersection()) {
		const combinedProperties = new Map();
		type.types.forEach(t => {
			if (t.symbol && t.symbol.flags & ts.SymbolFlags.TypeLiteral) {
				typeChecker.getPropertiesOfType(t).forEach(prop => {
					combinedProperties.set(prop.name, prop);
				});
			}
		});

		if (combinedProperties.size > 0) {
			const expandedProps = Array.from(combinedProperties).map(([name, prop]) => {
				const propType = typeChecker.getTypeOfSymbolAtLocation(prop, sourceFile);
				const jsDocTags = getJSDocTags(prop);
				let propString = '';
				if (jsDocTags.deprecated) {
					propString += `${indent}  // @deprecated: ${
						jsDocTags.deprecated === true ? '' : jsDocTags.deprecated
					}\n`;
				}
				propString += `${indent}  '${prefix}${name}': ${expandType(propType, indent + '  ', false, prefix)}`;
				return propString;
			});
			result = `{\n${expandedProps.join(',\n')}\n${indent}}`;
		} else {
			const types = type.types.map(t => expandType(t, indent, false, prefix)).join(' & ');
			result = types.includes('\n') ? `(${types})` : types;
		}
	} else if (type.isStringLiteral()) {
		result = `'${type.value}'`;
	} else if (type.isNumberLiteral()) {
		result = type.value.toString();
	} else if (type.symbol && type.symbol.flags & ts.SymbolFlags.Method) {
		const signatures = type.getCallSignatures();
		if (signatures.length) {
			const params = signatures[0]
				.getParameters()
				.map(
					p =>
						`'${prefix}${p.name}': ${expandType(
							typeChecker.getTypeOfSymbolAtLocation(p, sourceFile),
							indent,
							false,
							prefix,
						)}`,
				)
				.join(', ');
			const returnType = expandType(signatures[0].getReturnType(), indent, false, prefix);
			result = `(${params}) => ${returnType}`;
		}
	} else if (type.symbol && type.symbol.flags & ts.SymbolFlags.TypeLiteral) {
		const properties = typeChecker.getPropertiesOfType(type);
		if (properties.length === 0) {
			result = '{}';
		} else {
			const expandedProps = properties.map(prop => {
				const propType = typeChecker.getTypeOfSymbolAtLocation(prop, sourceFile);
				const jsDocTags = getJSDocTags(prop);
				let propString = '';
				if (jsDocTags.deprecated) {
					propString += `${indent}  // @deprecated: ${
						jsDocTags.deprecated === true ? '' : jsDocTags.deprecated
					}\n`;
				}
				propString += `${indent}  '${prefix}${prop.name}': ${expandType(
					propType,
					indent + '  ',
					false,
					prefix,
				)}`;
				return propString;
			});
			result = `{\n${expandedProps.join(',\n')}\n${indent}}`;
		}
	} else {
		result = typeChecker.typeToString(type);
	}

	if (isRoot && !type.isUnion()) {
		return `\`\`\`typescript\n${result}\n\`\`\``;
	}
	return result;
}

function getJSDocTags(symbol) {
	const tags = {};
	const jsDocTags = symbol.getJsDocTags();
	for (const tag of jsDocTags) {
		tags[tag.name] = tag.text ? tag.text.map(t => t.text).join(' ') : true;
	}
	return tags;
}
