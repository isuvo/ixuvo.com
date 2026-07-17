/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const existingAuthors = (() => {
    try {
      return app.findCollectionByNameOrId("blog_authors");
    } catch (error) {
      return null;
    }
  })();

  if (!existingAuthors) {
    const authors = new Collection({
      name: "blog_authors",
      type: "auth",
      authRule: "",
      manageRule: "@request.auth.collectionName = \"blog_authors\" && @request.auth.get(\"role\") = \"admin\"",
      listRule: "@request.auth.collectionName = \"blog_authors\"",
      viewRule: "@request.auth.collectionName = \"blog_authors\"",
      createRule: null,
      updateRule: "@request.auth.collectionName = \"blog_authors\" && (@request.auth.id = id || @request.auth.get(\"role\") = \"admin\")",
      deleteRule: null,
      passwordAuth: {
        enabled: true,
        identityFields: ["email"],
      },
      fields: [
        new TextField({
          name: "display_name",
          required: true,
          min: 2,
          max: 60,
        }),
        new SelectField({
          name: "role",
          required: true,
          maxSelect: 1,
          values: ["author", "admin"],
        }),
      ],
    });

    app.save(authors);
  }

  const authors = app.findCollectionByNameOrId("blog_authors");
  const existingPosts = (() => {
    try {
      return app.findCollectionByNameOrId("posts");
    } catch (error) {
      return null;
    }
  })();

  if (!existingPosts) {
    const posts = new Collection({
      name: "posts",
      type: "base",
      listRule: "status = \"published\" || @request.auth.collectionName = \"blog_authors\"",
      viewRule: "status = \"published\" || @request.auth.collectionName = \"blog_authors\"",
      createRule: "@request.auth.collectionName = \"blog_authors\"",
      updateRule: "@request.auth.collectionName = \"blog_authors\"",
      deleteRule: "@request.auth.collectionName = \"blog_authors\"",
      fields: [
        new RelationField({
          name: "author",
          required: true,
          collectionId: authors.id,
          maxSelect: 1,
        }),
        new TextField({
          name: "title",
          required: true,
          min: 4,
          max: 200,
        }),
        new TextField({
          name: "slug",
          required: true,
          min: 3,
          max: 120,
          pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
        }),
        new TextField({
          name: "summary",
          required: true,
          max: 1200,
        }),
        new TextField({
          name: "body_markdown",
          required: true,
        }),
        new SelectField({
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["draft", "review", "approved", "published", "archived"],
        }),
        new JSONField({
          name: "tags",
        }),
        new FileField({
          name: "cover_image",
          maxSelect: 1,
          maxSize: 5242880,
          mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
        }),
        new JSONField({
          name: "source_urls",
        }),
        new DateField({
          name: "published_at",
        }),
        new TextField({
          name: "linkedin_text",
          max: 4000,
        }),
        new TextField({
          name: "x_text",
          max: 4000,
        }),
      ],
      indexes: [
        "CREATE UNIQUE INDEX idx_posts_slug ON posts (slug)",
      ],
    });

    app.save(posts);
  }

  const existingQueue = (() => {
    try {
      return app.findCollectionByNameOrId("content_queue");
    } catch (error) {
      return null;
    }
  })();

  if (!existingQueue) {
    const queue = new Collection({
      name: "content_queue",
      type: "base",
      listRule: "@request.auth.collectionName = \"blog_authors\"",
      viewRule: "@request.auth.collectionName = \"blog_authors\"",
      createRule: "@request.auth.collectionName = \"blog_authors\"",
      updateRule: "@request.auth.collectionName = \"blog_authors\"",
      deleteRule: "@request.auth.collectionName = \"blog_authors\"",
      fields: [
        new RelationField({
          name: "author",
          required: true,
          collectionId: authors.id,
          maxSelect: 1,
        }),
        new TextField({
          name: "topic",
          required: true,
          max: 200,
        }),
        new JSONField({
          name: "keywords",
        }),
        new SelectField({
          name: "priority",
          required: true,
          maxSelect: 1,
          values: ["low", "medium", "high"],
        }),
        new SelectField({
          name: "status",
          required: true,
          maxSelect: 1,
          values: ["queued", "researching", "drafting", "review", "published", "archived"],
        }),
        new TextField({
          name: "notes",
        }),
      ],
    });

    app.save(queue);
  }
}, (app) => {
  const collectionNames = ["content_queue", "posts", "blog_authors"];

  for (const name of collectionNames) {
    try {
      const collection = app.findCollectionByNameOrId(name);
      app.delete(collection);
    } catch (error) {
      // ignore missing collections
    }
  }
})
