/// <reference path="../pb_data/types.d.ts" />
// Adds the fields the Obsidian sync agent needs on notes:
//   path - vault-relative path of the .md file ("Work/Meeting.md")
//   fm   - the file's raw YAML frontmatter, kept so unknown keys survive a round trip
migrate((app) => {
  const c = app.findCollectionByNameOrId("notes")
  c.fields.add(new TextField({ name: "path", max: 2000 }))
  c.fields.add(new TextField({ name: "fm", max: 50000 }))
  app.save(c)
}, (app) => {
  const c = app.findCollectionByNameOrId("notes")
  c.fields.removeByName("path")
  c.fields.removeByName("fm")
  app.save(c)
})
