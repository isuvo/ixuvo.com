/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const posts = app.findCollectionByNameOrId("posts");
  posts.fields.add(new BoolField({
    name: "legacy_imported",
  }));

  posts.fields.add(new TextField({
    name: "legacy_source_url",
    max: 1000,
  }));

  app.save(posts);
}, (app) => {
  const posts = app.findCollectionByNameOrId("posts");

  posts.fields.removeByName("legacy_imported");
  posts.fields.removeByName("legacy_source_url");

  app.save(posts);
})
