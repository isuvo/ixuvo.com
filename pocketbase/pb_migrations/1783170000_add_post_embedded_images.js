/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const posts = app.findCollectionByNameOrId("posts");

  if (!posts.fields.getByName("embedded_images")) {
    posts.fields.add(new FileField({
      name: "embedded_images",
      maxSelect: 30,
      maxSize: 10485760,
      mimeTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"],
    }));
  }

  app.save(posts);
}, (app) => {
  const posts = app.findCollectionByNameOrId("posts");

  try {
    posts.fields.removeByName("embedded_images");
  } catch (error) {
    // ignore missing field
  }

  app.save(posts);
})
