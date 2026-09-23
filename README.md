# @sudobility/writing_core

Headless writing engine for screenplays, teleplays, stage plays, radio,
AV scripts, graphic novels and manuscripts: a collaborative (Yjs) document
model, data-driven templates, editing commands, SmartType, per-session undo,
and deterministic layout and pagination — paragraph layout, page filling,
dual dialogue and column blocks, continueds, revision/lock display, headers/
footers and scene numbering, source↔layout mapping (caret, hit testing,
selection), and an incremental layout engine with a real paragraph cache —
that produce identical pages on every platform (Bun, Node, and JavaScriptCore
via Bun; Hermes and native JavaScriptCore CI are the host app's own
responsibility, see `docs/verification/V-02.md`).

## Installation

    bun add @sudobility/writing_core

## Usage

```ts
import {
  cryptoIdSource, createDocument, createSessionOrigins, executeCommand, getBuiltinTemplate, openDocument, registerBuiltinCommands,
} from '@sudobility/writing_core';

registerBuiltinCommands();
const ids = cryptoIdSource;
const doc = createDocument({ template: getBuiltinTemplate('screenplay-standard')!, uid: 'firebase-uid', ids });
const model = openDocument(doc, { ids, clock: Date.now, locale: 'en' });
const actor = { userId: 'firebase-uid', displayName: 'Writer', color: '#224466', kind: 'human' as const };
const origins = createSessionOrigins(actor);
const [heading] = model.elements();

executeCommand({
  doc, model, ids, actor, origin: origins.make('local-typing'), capabilities: new Set(['write']),
  command: { id: 'text.insert', params: { at: { elementId: heading!.id, offset: 0 }, text: 'INT. DINER - NIGHT' } },
});
console.log(model.scenes()[0]!.heading.location); // "DINER"
```

## Development

    bun install
    bun run verify

## License

BUSL-1.1
