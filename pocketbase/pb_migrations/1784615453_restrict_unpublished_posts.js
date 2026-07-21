/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const posts = app.findCollectionByNameOrId("posts");
  const publicOrVerifiedAuthor = "status = \"published\" || (@request.auth.collectionName = \"blog_authors\" && @request.auth.verified = true)";

  posts.listRule = publicOrVerifiedAuthor;
  posts.viewRule = publicOrVerifiedAuthor;

  app.save(posts);
}, (app) => {
  const posts = app.findCollectionByNameOrId("posts");
  posts.listRule = "";
  posts.viewRule = "";
  app.save(posts);
})
