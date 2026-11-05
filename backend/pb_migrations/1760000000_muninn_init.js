/// <reference path="../pb_data/types.d.ts" />
// Muninn schema. Every record belongs to one user; rules make data private per account.
// Dates are stored as plain "YYYY-MM-DD" text on purpose (no timezone surprises).
migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const own = "user = @request.auth.id"
  const keepOwner = "(@request.body.user:isset = false || @request.body.user = @request.auth.id)"

  const text = (name, o) => Object.assign({ type: "text", name: name }, o || {})
  const long = (name) => text(name, { max: 200000 })
  const num = (name) => ({ type: "number", name: name })
  const bool = (name) => ({ type: "bool", name: name })
  const sel = (name, values) => ({ type: "select", name: name, values: values, maxSelect: 1 })
  const json = (name) => ({ type: "json", name: name, maxSize: 2000000 })
  const rel = (name, id, cascade) => ({
    type: "relation", name: name, collectionId: id, maxSelect: 1, cascadeDelete: !!cascade,
  })

  const make = (name, fields) => {
    const c = new Collection({
      type: "base",
      name: name,
      listRule: own,
      viewRule: own,
      createRule: '@request.auth.id != "" && @request.body.user = @request.auth.id',
      updateRule: own + " && " + keepOwner,
      deleteRule: own,
      fields: [
        { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      ].concat(fields).concat([
        { type: "autodate", name: "created", onCreate: true },
        { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
      ]),
      indexes: ["CREATE INDEX idx_" + name + "_user ON " + name + " (user)"],
    })
    app.save(c)
    return c
  }

  make("inbox", [text("text", { required: true, max: 5000 }), sel("kind", ["note", "task", "idea", "link"])])

  const goals = make("goals", [
    text("title", { required: true }), long("description"),
    sel("period", ["year", "quarter", "month"]), text("target_date"),
    num("progress"), sel("status", ["active", "done", "dropped"]),
  ])

  make("tasks", [
    text("title", { required: true }), long("notes"),
    sel("status", ["todo", "in_progress", "done"]), sel("priority", ["low", "medium", "high"]),
    text("due"), text("project"), rel("goal", goals.id, false),
    json("subtasks"), text("tags"), text("done_at"),
  ])

  make("events", [
    text("title", { required: true }), text("date", { required: true }), text("end_date"),
    text("time"), text("location"), long("notes"),
  ])

  make("expenses", [
    text("title", { required: true }), num("amount"), sel("type", ["expense", "income"]),
    text("category"), text("date"), text("note"),
  ])
  make("budgets", [text("category", { required: true }), num("amount")])
  make("subscriptions", [
    text("name", { required: true }), num("amount"), sel("cycle", ["weekly", "monthly", "yearly"]),
    text("next_due"), text("category"), bool("active"), long("notes"),
  ])

  const habits = make("habits", [
    text("name", { required: true }), sel("kind", ["habit", "maintenance"]),
    sel("frequency", ["daily", "weekly"]), num("target_per_week"),
    num("interval_days"), text("last_done"), bool("archived"), long("notes"),
  ])
  make("habit_logs", [rel("habit", habits.id, true), text("date", { required: true })])

  make("media", [
    text("title", { required: true }), sel("type", ["movie", "series", "anime", "book", "game"]),
    sel("status", ["planned", "in_progress", "done", "dropped"]), num("rating"),
    text("url"), long("notes"), text("tags"), text("done_at"),
  ])
  make("wishlist", [
    text("name", { required: true }), num("price"), text("url"), text("store"),
    sel("urgency", ["low", "medium", "high"]), sel("status", ["wanted", "bought", "dropped"]), long("notes"),
  ])

  make("bookmarks", [
    text("title", { required: true }), text("url"), sel("kind", ["link", "tool", "snippet"]),
    long("content"), text("category"), text("tags"), bool("pinned"),
  ])
  make("notes", [
    text("title", { required: true }), long("content"), text("category"), text("tags"), bool("pinned"),
  ])
  make("journal", [text("date", { required: true }), num("mood"), long("content"), text("tags")])

  make("contacts", [
    text("name", { required: true }), text("relation"), text("phone"), text("email"),
    text("last_contact"), num("contact_every_days"), long("notes"),
  ])
  make("documents", [
    text("title", { required: true }), sel("kind", ["id", "insurance", "warranty", "finance", "other"]),
    text("number"), text("expires"), long("notes"),
  ])
  make("health_logs", [
    text("date", { required: true }),
    sel("type", ["weight", "blood_pressure", "sleep", "checkup", "medication", "other"]),
    num("value"), text("unit"), long("notes"),
  ])
  make("accounts", [
    text("name", { required: true }), sel("kind", ["asset", "liability"]), num("balance"), long("notes"),
  ])
  make("reviews", [
    sel("period", ["week", "month", "year"]), text("period_key", { required: true }),
    long("wins"), long("lessons"), long("next_focus"),
  ])
  make("reminders", [
    text("title", { required: true }), text("due", { required: true }),
    sel("repeat", ["none", "daily", "weekly", "monthly", "yearly"]), bool("done"), long("notes"),
  ])
}, (app) => {
  const names = [
    "reminders", "reviews", "accounts", "health_logs", "documents", "contacts", "journal", "notes",
    "bookmarks", "wishlist", "media", "habit_logs", "habits", "subscriptions", "budgets", "expenses",
    "events", "tasks", "goals", "inbox",
  ]
  names.forEach((n) => {
    try { app.delete(app.findCollectionByNameOrId(n)) } catch (e) { /* already gone */ }
  })
})
