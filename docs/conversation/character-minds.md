# Character Minds

Character Mind is an experimental managed agent that applies the Karpathy LLM Wiki pattern to one character in one Conversation. It compiles the current Character Card and formed Daily Memories into an interlinked Markdown wiki. This iteration returns standalone query briefings; it does not alter normal character response generation.

## Enable the agent

Open the Conversation's **Agents** settings, enable **Character Mind**, and give it a usable text-generation connection. The same connection performs ingest, query, and lint operations. Character Mind does not run in the normal pre-generation, parallel, or post-generation pipelines.

There is no Character Mind screen in this iteration. Use the API to run operations and inspect or edit the files directly.

## Files

Each mind lives below:

```text
DATA_DIR/character-minds/<chatId>/<characterId>/
├── SCHEMA.md
├── index.md
├── log.md
├── raw/
│   ├── character-card/
│   └── daily-memories/
└── wiki/
```

- `raw/` contains deterministic, immutable source snapshots written by Marinara. Do not edit them.
- `wiki/` contains the agent-maintained synthesis.
- `SCHEMA.md` defines the wiki rules and may be edited manually.
- `index.md` is the wiki catalog.
- `log.md` is Marinara's append-only operation record and the durable ingest ledger.

On desktop, open either `character-minds` or an individual mind directory as an Obsidian vault. Docker users must bind-mount `DATA_DIR` to reach the Markdown. Android app storage is generally inaccessible without root access, and no in-app file browser is provided.

## API operations

Replace `<chatId>` and `<characterId>` in these paths:

| Method and path | Operation |
| --- | --- |
| `GET /api/chats/<chatId>/character-minds/<characterId>/status` | Inspect initialization, pending sources, current operation, and last log result |
| `POST .../build` | Create the mind, snapshot current sources, and ingest them in order |
| `POST .../sync` | Snapshot changed sources and ingest pending revisions |
| `POST .../query` | Return a detailed briefing grounded in wiki pages and cited raw sources |
| `POST .../lint` | Check and repair the wiki using existing evidence |
| `POST .../cancel` | Abort the active model operation without deleting files |

Sync accepts an optional bounded batch size:

```json
{ "maxSources": 10 }
```

Query accepts up to 32 KiB of caller text:

```json
{ "query": "How does this situation relate to the character's history with Alex?" }
```

Build intentionally fails when the mind directory already exists; use Sync to resume a partial Build. After an existing mind's Daily Memories change, Marinara attempts a one-source Sync in the background. Every seventh successful ingest also queues lint. These background operations never fail the Daily Memory write.

There is no API for browsing, editing, clearing, or opening the directory. To clear a mind in this iteration, stop Marinara and deliberately remove that character's mind directory yourself. Normal chat or character deletion removes the associated directory, and normal backups include `character-minds`.
