import * as sharedL10n from '@vscode/l10n';
import { l10n } from 'vscode';

// Runs before extension modules so shared package constants use VS Code's selected bundle.
sharedL10n.config({ contents: l10n.bundle ?? {} });
