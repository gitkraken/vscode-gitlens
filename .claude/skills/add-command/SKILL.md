---
name: add-command
description: Create new VS Code commands with all required boilerplate
---

# /add-command - Create New Command

Scaffold a new VS Code command with all required boilerplate.

## Usage

```
/add-command [name]
```

## Information Needed

1. **Command ID** — e.g., `myNewFeature` (becomes `gitlens.myNewFeature`)
2. **Label** — Display name in command palette
3. **Base class**:
   - `GlCommandBase` — No editor required (opening panels, showing pickers)
   - `ActiveEditorCommand` — Requires active editor
   - `ActiveEditorCachedCommand` — Like ActiveEditorCommand with "repeat last command" support
4. **Variants** (optional): `:views`, `:graph`, `:scm` suffixes for context menus

## Files to Create/Modify

### 1. Command File: `src/commands/{commandName}.ts`

```typescript
import type { TextEditor, Uri } from 'vscode';
import type { Container } from '../container.js';
import { command } from '../system/-webview/command.js';
import { {BaseClass} } from './commandBase.js';

export interface {CommandName}CommandArgs {
    // Define args if needed
}

@command()
export class {CommandName}Command extends {BaseClass} {
    constructor(private readonly container: Container) {
        super([
            'gitlens.{commandId}',
            // Add variants here
        ]);
    }

    async execute(editor?: TextEditor, uri?: Uri, args?: {CommandName}CommandArgs): Promise<void> {
        // TODO: Implement
    }
}
```

### 2. Import in `src/commands.ts`

```typescript
import './commands/{commandName}.js';
```

### 3. Add to `contributions.json`

Under `"commands"` key:

```json
"gitlens.{commandId}": {
    "label": "{Label}",
    "category": "GitLens",
    "commandPalette": "gitlens:enabled"
}
```

For `:views` variant:

```json
"gitlens.{commandId}:views": {
    "label": "{Label}",
    "icon": "$(icon-name)",
    "menus": {
        "view/item/context": [{
            "when": "viewItem =~ /gitlens:/ && gitlens:enabled",
            "group": "1_gitlens"
        }]
    }
}
```

### 4. Run Generation

```bash
pnpm run generate:contributions && pnpm run generate:commandTypes
```

## Common `when` Clauses

- `gitlens:enabled` — Extension is enabled
- `!gitlens:readonly` — Not in readonly mode
- `!gitlens:untrusted` — Workspace is trusted
- `gitlens:plus` — Pro features available
- `viewItem =~ /gitlens:commit/` — On a commit node
- `viewItem =~ /gitlens:branch/` — On a branch node
