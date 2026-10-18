## Work tracking (DevTrack MCP)

All work on this repo is tracked in the `devtrack` MCP server. Project slug: `<slug>`.

- **Start of session:** call `agenda` with `project="<slug>"` and read the latest handoff
  (`list_notes` with `kind="handoff"`, `limit=1`) before doing anything.
- **Planning work:** `create_item` for every ticket or feature, with `branch`, `estimate_hours`,
  `cost` and the agreed dates: `submit_on`, `merge_on`, `deploy_on`, `due_on`.
- **Built ahead of schedule:** set `status="parked"` and keep `submit_on` at the real date.
  On that day run `redate_plan` and give me the script. Never force-push without asking me.
- **Status changes:** keep items current with `update_item` (in_progress, blocked, submitted with
  `pr_url`, merged, deployed, done) and log `actual_hours` when finishing.
- **Anything I have to do** (secrets, approvals, device tests, payments, manual deploys):
  put it in `handoff.user_todos` or create an item with `assignee="me"`. Don't leave it only in chat.
  If it waits on someone else first, set `waiting_for` (and `snoozed_until` to check back).
- **After pushing or opening an MR:** call `git_sync` with the `item_id`, so the item picks up
  the MR and its status.
- **End of session:** always call `handoff` with summary, done, next_steps and user_todos.
