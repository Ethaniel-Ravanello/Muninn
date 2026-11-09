/// <reference path="../pb_data/types.d.ts" />
// 1. habit_logs: one log per habit per day. Existing duplicates are removed first, otherwise the
//    unique index could not be created.
// 2. attachments: an update may not move the record to another user (same guard as every other collection).
migrate((app) => {
  const logs = app.findCollectionByNameOrId("habit_logs")
  const seen = {}
  const records = app.findAllRecords("habit_logs")
  records.forEach((r) => {
    const key = r.getString("habit") + "|" + r.getString("date")
    if (seen[key]) app.delete(r)
    else seen[key] = true
  })
  logs.addIndex("idx_habit_logs_habit_date", true, "habit, date", "")
  app.save(logs)

  const att = app.findCollectionByNameOrId("attachments")
  att.updateRule =
    "user = @request.auth.id && (@request.body.user:isset = false || @request.body.user = @request.auth.id)"
  app.save(att)
}, (app) => {
  const logs = app.findCollectionByNameOrId("habit_logs")
  logs.removeIndex("idx_habit_logs_habit_date")
  app.save(logs)

  const att = app.findCollectionByNameOrId("attachments")
  att.updateRule = "user = @request.auth.id"
  app.save(att)
})
