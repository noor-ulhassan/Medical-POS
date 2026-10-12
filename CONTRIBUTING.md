# Contributing

## Setup

```bash
nvm use            # Node 22
npm install
npm run dev
```

Before opening a pull request, run `npm run check && npm run smoke`. CI runs the same steps.

## Adding a feature: the usual path

1. **Schema change?** Add `src/main/db/migrations/00N_description.js` exporting `{ version, name, up(db) }` and register it in `migrations/index.js`. Never edit a migration that has shipped. To change a table, create the new table, copy the rows, then drop the old one. Add a test that starts from a database of the previous version (see `test/fixtures/v1_1_database.js`).
2. **Business logic** goes in a service under `src/main/services/`. Validate every input with `lib/validate.js`, throw `AppError`s for anything the user should see, wrap writes in `db.transaction()`, and call `recordAudit()` for sensitive actions.
3. **Expose it** by adding a route in `src/main/ipc/routes.js` with the right `permission`. Add a permission to `src/shared/permissions.js` if none fits.
4. **Test it** in `test/*.test.js` through `app.call(...)` (the same dispatcher the UI uses), so permissions and validation are covered too.
5. **UI**: add or extend a component in `src/renderer/src/features/<area>/`. Use `call()` from `lib/api.js` for data, `useToast().guard()` around async handlers, `toast()` and `useConfirm()` for feedback, and the primitives in `ui/` (Button, Field, Modal, Table, Pill…) rather than one-off markup. Hide controls a role may not use with `can('permission')` from `useApp()`. Style with Tailwind utilities and the design tokens (`bg-surface`, `text-ink-2`, `border-foil`, `bg-teal`…), never raw colours. If the change affects a main flow, extend `scripts/smoke-scenario.js`.

## Conventions

- Money is integer cents everywhere. Convert user input with `toCents()`, display with `money()`.
- Database rows are returned as-is (snake_case). Service inputs are camelCase objects.
- Copy is sentence case, plain and active ("Save changes", not "Submit"). A toast repeats the button's verb ("Product saved").
- Keep components small and focused. Screens share data through `state/AppState.jsx` and the current sale through `state/Cart.jsx`, never by reaching into each other's DOM.
- Commit messages: imperative mood, explain *why* when it is not obvious.

## Releasing

1. Update `CHANGELOG.md` and the version in `package.json`.
2. Tag: `git tag -a v2.1.0 -m "v2.1.0" && git push origin v2.1.0`.
3. The Release workflow builds the installers and publishes them after the checks pass.
