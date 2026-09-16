# @sudobility/writing_core

Headless writing engine for screenplays, teleplays, stage plays, radio,
AV scripts, graphic novels and manuscripts: a collaborative (Yjs) document
model, data-driven templates, editing commands, SmartType, and per-session
undo. Deterministic layout and pagination that produce identical pages on
every platform is a later milestone, not part of this package yet.

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
