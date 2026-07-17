/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const posts = app.findCollectionByNameOrId("posts");
  const authors = app.findCollectionByNameOrId("blog_authors");

  function ensureField(name, buildField) {
    try {
      posts.fields.getByName(name);
    } catch (error) {
      posts.fields.add(buildField());
    }
  }

  posts.listRule = "";
  posts.viewRule = "";
  posts.createRule = "@request.auth.collectionName = \"blog_authors\"";
  posts.updateRule = "@request.auth.collectionName = \"blog_authors\"";
  posts.deleteRule = "@request.auth.collectionName = \"blog_authors\"";

  ensureField("author", () => new RelationField({
    name: "author",
    collectionId: authors.id,
    maxSelect: 1,
  }));

  ensureField("title", () => new TextField({
    name: "title",
    required: true,
    min: 1,
    max: 200,
  }));

  ensureField("slug", () => new TextField({
    name: "slug",
    required: true,
    min: 1,
    max: 160,
    pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
  }));

  ensureField("summary", () => new TextField({
    name: "summary",
    required: true,
    max: 1200,
  }));

  ensureField("body_markdown", () => new TextField({
    name: "body_markdown",
    required: true,
  }));

  ensureField("status", () => new SelectField({
    name: "status",
    required: true,
    maxSelect: 1,
    values: ["draft", "review", "approved", "published", "archived"],
  }));

  ensureField("tags", () => new JSONField({
    name: "tags",
  }));

  ensureField("cover_image", () => new FileField({
    name: "cover_image",
    maxSelect: 1,
    maxSize: 5242880,
    mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  }));

  ensureField("source_urls", () => new JSONField({
    name: "source_urls",
  }));

  ensureField("published_at", () => new DateField({
    name: "published_at",
  }));

  ensureField("linkedin_text", () => new TextField({
    name: "linkedin_text",
    max: 4000,
  }));

  ensureField("x_text", () => new TextField({
    name: "x_text",
    max: 4000,
  }));

  app.save(posts);
}, (app) => {
  const posts = app.findCollectionByNameOrId("posts");
  const removable = [
    "author",
    "title",
    "slug",
    "summary",
    "body_markdown",
    "status",
    "tags",
    "cover_image",
    "source_urls",
    "published_at",
    "linkedin_text",
    "x_text",
  ];

  removable.forEach((name) => {
    try {
      posts.fields.removeByName(name);
    } catch (error) {
      // ignore missing fields
    }
  });

  app.save(posts);
})
