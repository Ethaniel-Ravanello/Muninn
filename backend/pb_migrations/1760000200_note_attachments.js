/// <reference path="../pb_data/types.d.ts" />
// Attachments for notes (pasted / uploaded images live here).
// A note keeps plain Markdown (`![alt](<url>)`), so the vault sync stays text-only;
// the actual bytes are a private file on one record per image.
migrate((app) => {
  const users = app.findCollectionByNameOrId("users")
  const own = "user = @request.auth.id"

  const c = new Collection({
    type: "base",
    name: "attachments",
    listRule: own,
    viewRule: own,
    createRule: '@request.auth.id != "" && @request.body.user = @request.auth.id',
    updateRule: own,
    deleteRule: own,
    fields: [
      { type: "relation", name: "user", required: true, collectionId: users.id, maxSelect: 1, cascadeDelete: true },
      { type: "text", name: "name", max: 255 },
      {
        type: "file", name: "file", required: true, maxSelect: 1, maxSize: 15000000,
        mimeTypes: [
          "image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml",
          "image/bmp", "image/avif",
        ],
      },
      { type: "autodate", name: "created", onCreate: true },
      { type: "autodate", name: "updated", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_attachments_user ON attachments (user)"],
  })
  app.save(c)
}, (app) => {
  try { app.delete(app.findCollectionByNameOrId("attachments")) } catch (e) { /* already gone */ }
})
