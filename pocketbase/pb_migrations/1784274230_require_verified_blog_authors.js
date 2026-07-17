/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const authors = app.findCollectionByNameOrId("blog_authors");
  const posts = app.findCollectionByNameOrId("posts");

  authors.authRule = "verified = true";
  authors.manageRule = "@request.auth.collectionName = \"blog_authors\" && @request.auth.verified = true && @request.auth.role = \"admin\"";
  authors.listRule = "@request.auth.collectionName = \"blog_authors\" && @request.auth.verified = true";
  authors.viewRule = "@request.auth.collectionName = \"blog_authors\" && @request.auth.verified = true";
  authors.updateRule = "@request.auth.collectionName = \"blog_authors\" && @request.auth.verified = true && (@request.auth.id = id || @request.auth.role = \"admin\")";

  const verifiedAuthorRule = "@request.auth.collectionName = \"blog_authors\" && @request.auth.verified = true";
  posts.createRule = verifiedAuthorRule;
  posts.updateRule = verifiedAuthorRule;
  posts.deleteRule = verifiedAuthorRule;

  app.save(authors);
  app.save(posts);
}, (app) => {
  const authors = app.findCollectionByNameOrId("blog_authors");
  const posts = app.findCollectionByNameOrId("posts");

  authors.authRule = "";
  authors.manageRule = "@request.auth.collectionName = \"blog_authors\" && @request.auth.role = \"admin\"";
  authors.listRule = "@request.auth.collectionName = \"blog_authors\"";
  authors.viewRule = "@request.auth.collectionName = \"blog_authors\"";
  authors.updateRule = "@request.auth.collectionName = \"blog_authors\" && (@request.auth.id = id || @request.auth.role = \"admin\")";

  const authorRule = "@request.auth.collectionName = \"blog_authors\"";
  posts.createRule = authorRule;
  posts.updateRule = authorRule;
  posts.deleteRule = authorRule;

  app.save(authors);
  app.save(posts);
})
