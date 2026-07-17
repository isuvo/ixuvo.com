/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const posts = app.findCollectionByNameOrId("posts");
  posts.listRule = "";
  posts.viewRule = "";
  app.save(posts);
}, (app) => {
  const posts = app.findCollectionByNameOrId("posts");
  posts.listRule = "status = \"published\" || @request.auth.collectionName = \"blog_authors\"";
  posts.viewRule = "status = \"published\" || @request.auth.collectionName = \"blog_authors\"";
  app.save(posts);
})
