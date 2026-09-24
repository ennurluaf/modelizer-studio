# Modelizer Studio

A modern web version of Modelizer for drawing **CDM → LDM → PDM** data models that follow the
LAM 23-24 database naming convention. Node.js backend (CommonJS, OOP, zero dependencies) and a
plain HTML/CSS/JS frontend (ES modules, Font Awesome icons).

## Run it

```bash
npm start          # http://localhost:3000   (PORT=4000 npm start to change the port)
npm test           # transformation round-trip test (the PDF's Person/Gender/Country example)
```

Requires Node 18+. No `npm install` needed.

## What it does

- **One naming convention, enforced.** Every name you type is normalised live (`First Name` → `firstName`,
  `person` → `Person`), and the rules from the PDF are checked: singular nouns, unique names,
  3rd-person verbs for associations, `pk_`, `fk_<table>_<verb>[_<role>]`, `pkfk_`, `fkc_Source_verb_Target`,
  `idx_<type>_<column>`. Problems are underlined on the diagram and listed in the issues panel (Alt+V).
- **Transformations** (Transform menu or the arrows between the CDM/LDM/PDM tabs): CDM → LDM → PDM and
  back PDM → LDM → CDM. Optional *Keep LDM and PDM in sync* setting regenerates them after every CDM edit.
- **Synced layout:** a class and its table share the same position in the CDM and the LDM.
- **Link names are suggested** from the two class names (e.g. Trainer → TrainingSession: `coaches`, `organizes`…).
- **Multi-select** with Ctrl/Shift-click or by dragging a marquee on empty space; move, delete, copy
  tables, links and fields together. Drag fields to another table (Alt copies), or copy/paste them.
- **Two zooms:** diagram zoom per model (status bar, Ctrl+scroll) and interface zoom for menus and panels.
- **Settings:** delete confirmation on/off, overwrite confirmation, snap to grid, theme, and fully
  re-bindable keyboard shortcuts (click a shortcut, press the new keys).
- **One JSON file** holds all three models plus layout. Import by file, drag-and-drop or pasting into a
  textarea; export JSON, or export MySQL/MariaDB DDL from the PDM.
- **Print / save as PDF:** choose which models (one page each), orientation and paper size.
- Save/open models on the server (`data/*.json`); a draft is also kept in your browser.

## Default shortcuts (Ctrl = ⌘ on macOS)

| Action | Keys | Action | Keys |
|---|---|---|---|
| Add table/class | N | Add field | F |
| Link tool | L | Select tool | V |
| Rename | F2 / double-click | Delete | Delete |
| Copy / Cut / Paste | Ctrl+C / X / V | Duplicate | Ctrl+D |
| Undo / Redo | Ctrl+Z / Ctrl+Y | Select all | Ctrl+A |
| CDM / LDM / PDM tab | Alt+1 / 2 / 3 | Generate LDM / PDM | Alt+L / Alt+P |
| Rebuild CDM from PDM | Alt+C | Naming issues | Alt+V |
| Save / Export JSON | Ctrl+S / Ctrl+Shift+S | Import | Ctrl+O |
| Print | Ctrl+P | Settings | Ctrl+, |
| Diagram zoom | Ctrl+= / Ctrl+- / Ctrl+0 | Fit | Shift+F |
| Interface zoom | Ctrl+Shift+= / - / 0 | Pan | scroll, Space+drag, middle-drag |

## Project layout

```
server.js                  entry point
shared/                    used by both backend and browser (UMD)
  NamingConvention.js      normalise + validate every kind of name
  LinkNameSuggester.js     association verb suggestions
  ModelValidator.js        whole-document convention check
src/
  domain/                  ModelDocument, Transformer base + 4 transformers,
                           TransformationService, SqlDdlGenerator
  repositories/            ModelRepository (JSON files in data/)
  controllers/             Model, Transform and Tool controllers
  server/                  Router, StaticFileServer, Application
public/
  index.html, css/app.css
  js/core/                 Store (undo/redo), Settings, KeybindingManager, commands, API client
  js/adapters/             CdmAdapter, LdmAdapter, PdmAdapter (one editing API for all models)
  js/ui/                   DiagramRenderer, DiagramView, Inspector, IssuesPanel, Modal, Dialogs, PrintService
  samples/protraining360.json
```

## API

| Method | Path | Body |
|---|---|---|
| GET | `/api/models` | – |
| GET/PUT/DELETE | `/api/models/:id` | `{ document }` for PUT |
| POST | `/api/models` | `{ document }` |
| POST | `/api/transform/:direction` | `{ document }` — `cdm-to-ldm`, `ldm-to-pdm`, `cdm-to-pdm`, `pdm-to-ldm`, `ldm-to-cdm`, `pdm-to-cdm` |
| POST | `/api/import` | `{ text }` |
| POST | `/api/validate`, `/api/export/sql` | `{ document }` |
| POST | `/api/suggest/link-names` | `{ source, target, existing? }` |
