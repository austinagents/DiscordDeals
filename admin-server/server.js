import express from "express";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand
} from "@aws-sdk/client-s3";

import {
  getSignedUrl
} from "@aws-sdk/s3-request-presigner";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../.env")
});

const R2_BUCKET =
  process.env.R2_BUCKET;

const r2 =
  new S3Client({
    region: "auto",

    endpoint:
      `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,

    credentials: {
      accessKeyId:
        process.env.R2_ACCESS_KEY_ID,

      secretAccessKey:
        process.env.R2_SECRET_ACCESS_KEY
    }
  });

const PORT = 3002;
const ORIGIN = "https://partnerlinks.app";
const REDIRECT_URI =
  `${ORIGIN}/admin-auth/callback`;

const db = new Database(
  path.resolve(
    __dirname,
    "../creator-deals.db"
  )
);

db.pragma("journal_mode = WAL");

function columns(table) {
  return new Set(
    db.prepare(
      `PRAGMA table_info(${table})`
    )
      .all()
      .map(row => row.name)
  );
}

function addColumn(
  table,
  name,
  definition
) {
  if (!columns(table).has(name)) {
    db.exec(
      `ALTER TABLE ${table}
       ADD COLUMN ${definition}`
    );
  }
}

addColumn(
  "products",
  "sort_order",
  "sort_order INTEGER NOT NULL DEFAULT 0"
);

addColumn(
  "products",
  "category_sort_order",
  "category_sort_order INTEGER NOT NULL DEFAULT 0"
);

db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`);

db.prepare(`
  INSERT OR IGNORE INTO app_settings (
    key,
    value
  )
  VALUES (?, ?)
`).run(
  "category_order",
  JSON.stringify([
    "All",
    "Fashion",
    "Food",
    "Sports",
    "Home",
    "Beauty",
    "Tech",
    "Other"
  ])
);

db.exec(`
  CREATE TABLE IF NOT EXISTS product_videos (
    product_id TEXT NOT NULL,
    slot INTEGER NOT NULL,
    video_blob BLOB NOT NULL,
    video_filename TEXT,
    video_mime TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id, slot)
  )
`);

addColumn(
  "product_videos",
  "video_key",
  "video_key TEXT"
);

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 80 * 1024 * 1024
  }
});

app.use(express.json());

const sessions = new Map();

function parseCookies(req) {
  const raw = req.headers.cookie || "";

  return Object.fromEntries(
    raw
      .split(";")
      .map(v => v.trim())
      .filter(Boolean)
      .map(item => {
        const i = item.indexOf("=");

        return [
          decodeURIComponent(
            i === -1
              ? item
              : item.slice(0, i)
          ),
          decodeURIComponent(
            i === -1
              ? ""
              : item.slice(i + 1)
          )
        ];
      })
  );
}

function setCookie(
  res,
  name,
  value,
  maxAge
) {
  res.append(
    "Set-Cookie",
    [
      `${name}=${encodeURIComponent(value)}`,
      "Path=/",
      "HttpOnly",
      "Secure",
      "SameSite=Lax",
      `Max-Age=${maxAge}`
    ].join("; ")
  );
}

function clearCookie(res, name) {
  res.append(
    "Set-Cookie",
    `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`
  );
}

function currentSession(req) {
  const id =
    parseCookies(req)
      .partnerlinks_admin;

  if (!id) {
    return null;
  }

  const session =
    sessions.get(id);

  if (
    !session ||
    session.expiresAt < Date.now()
  ) {
    if (id) {
      sessions.delete(id);
    }

    return null;
  }

  return session;
}

function requireAdmin(req, res, next) {
  const session =
    currentSession(req);

  if (!session) {
    return res
      .status(401)
      .json({
        error: "Authentication required"
      });
  }

  req.admin = session.user;

  next();
}

function safeId(name) {
  const base =
    String(name || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) ||
    "product";

  let candidate = base;
  let n = 2;

  while (
    db.prepare(
      "SELECT id FROM products WHERE id = ?"
    ).get(candidate)
  ) {
    candidate =
      `${base}-${n++}`;
  }

  return candidate;
}

function normalizeProduct(row) {
  if (!row) return null;

  const {
    image_blob,
    ...safe
  } = row;

  const creatorVideos =
    db.prepare(
      `SELECT
         slot,
         video_filename,
         video_mime
       FROM product_videos
       WHERE product_id = ?
       ORDER BY slot ASC`
    )
      .all(String(row.id))
      .map(video => ({
        slot:
          Number(video.slot),

        filename:
          video.video_filename || "",

        mime:
          video.video_mime ||
          "video/mp4"
      }));

  return {
    ...safe,

    creator_videos:
      creatorVideos,
    active: Boolean(row.active),
    shop_ads:
      row.shop_ads &&
      row.shop_ads !== "null" &&
      row.shop_ads !== "undefined"
        ? row.shop_ads
        : "—",

    free_sample:
      row.free_sample ||
      "Auto-Approved",

    requirements:
      row.requirements ||
      "1 TikTok Shoppable Video"
  };
}

function productById(id) {
  return normalizeProduct(
    db.prepare(
      "SELECT * FROM products WHERE id = ?"
    ).get(String(id))
  );
}


function saveProductVideos(
  productId,
  files,
  body
) {
  for (
    let slot = 1;
    slot <= 4;
    slot++
  ) {
    const remove =
      String(
        body?.[
          `remove_video_${slot}`
        ] || ""
      ) === "true";

    if (remove) {
      db.prepare(
        `DELETE FROM product_videos
         WHERE product_id = ?
         AND slot = ?`
      ).run(
        String(productId),
        slot
      );
    }

    const file =
      files?.[
        `video_${slot}`
      ]?.[0];

    if (!file) {
      continue;
    }

    db.prepare(`
      INSERT INTO product_videos (
        product_id,
        slot,
        video_blob,
        video_filename,
        video_mime,
        updated_at
      )
      VALUES (
        ?, ?, ?, ?, ?,
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(
        product_id,
        slot
      )
      DO UPDATE SET
        video_blob =
          excluded.video_blob,
        video_filename =
          excluded.video_filename,
        video_mime =
          excluded.video_mime,
        updated_at =
          CURRENT_TIMESTAMP
    `).run(
      String(productId),
      slot,
      file.buffer,
      file.originalname,
      file.mimetype ||
        "video/mp4"
    );
  }
}


/* ===============================
   BROWSER AUTH
================================ */

app.get(
  "/admin-auth/login",
  (req, res) => {
    const state =
      crypto.randomBytes(32)
        .toString("hex");

    setCookie(
      res,
      "partnerlinks_oauth_state",
      state,
      600
    );

    const url =
      new URL(
        "https://discord.com/oauth2/authorize"
      );

    url.search =
      new URLSearchParams({
        client_id:
          process.env.CLIENT_ID,

        response_type:
          "code",

        redirect_uri:
          REDIRECT_URI,

        scope:
          "identify",

        state
      }).toString();

    res.redirect(
      url.toString()
    );
  }
);


app.get(
  "/admin-auth/callback",
  async (req, res) => {
    try {
      const cookies =
        parseCookies(req);

      if (
        !req.query.state ||
        req.query.state !==
          cookies.partnerlinks_oauth_state
      ) {
        return res
          .status(400)
          .send(
            "Invalid OAuth state"
          );
      }

      clearCookie(
        res,
        "partnerlinks_oauth_state"
      );

      const tokenResponse =
        await fetch(
          "https://discord.com/api/oauth2/token",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/x-www-form-urlencoded"
            },

            body:
              new URLSearchParams({
                client_id:
                  process.env.CLIENT_ID,

                client_secret:
                  process.env
                    .DISCORD_CLIENT_SECRET,

                grant_type:
                  "authorization_code",

                code:
                  String(
                    req.query.code || ""
                  ),

                redirect_uri:
                  REDIRECT_URI
              })
          }
        );

      const token =
        await tokenResponse.json();

      if (
        !tokenResponse.ok ||
        !token.access_token
      ) {
        console.error(
          "Admin OAuth token error:",
          token
        );

        return res
          .status(401)
          .send(
            "Discord authentication failed"
          );
      }

      const userResponse =
        await fetch(
          "https://discord.com/api/users/@me",
          {
            headers: {
              Authorization:
                `Bearer ${token.access_token}`
            }
          }
        );

      const user =
        await userResponse.json();

      if (!userResponse.ok) {
        return res
          .status(401)
          .send(
            "Could not identify Discord user"
          );
      }

      if (
        String(user.id) !==
        String(
          process.env
            .ADMIN_DISCORD_USER_ID
        )
      ) {
        return res
          .status(403)
          .send(
            "This Discord account is not authorized for Partnerlinks Admin."
          );
      }

      const sessionId =
        crypto.randomBytes(32)
          .toString("hex");

      sessions.set(
        sessionId,
        {
          user: {
            id: user.id,
            username:
              user.global_name ||
              user.username,

            avatar:
              user.avatar
          },

          expiresAt:
            Date.now() +
            12 * 60 * 60 * 1000
        }
      );

      setCookie(
        res,
        "partnerlinks_admin",
        sessionId,
        12 * 60 * 60
      );

      res.redirect(
        "/admin"
      );

    } catch (error) {
      console.error(error);

      res
        .status(500)
        .send(
          "Admin authentication failed"
        );
    }
  }
);


app.get(
  "/admin-auth/me",
  (req, res) => {
    const session =
      currentSession(req);

    if (!session) {
      return res
        .status(401)
        .json({
          authenticated: false
        });
    }

    res.json({
      authenticated: true,
      user: session.user
    });
  }
);


app.post(
  "/admin-auth/logout",
  (req, res) => {
    const id =
      parseCookies(req)
        .partnerlinks_admin;

    if (id) {
      sessions.delete(id);
    }

    clearCookie(
      res,
      "partnerlinks_admin"
    );

    res.json({
      ok: true
    });
  }
);


/* ===============================
   DISPLAY ORDER API
================================ */

app.get(
  "/admin-api/order",
  requireAdmin,
  (req, res) => {
    const setting =
      db.prepare(
        `SELECT value
         FROM app_settings
         WHERE key = ?`
      ).get("category_order");

    let categories;

    try {
      categories =
        JSON.parse(
          setting?.value || "[]"
        );
    } catch {
      categories = [];
    }

    if (!categories.length) {
      categories = [
        "All",
        "Fashion",
        "Food",
        "Sports",
        "Home",
        "Beauty",
        "Tech",
        "Other"
      ];
    }

    const products =
      db.prepare(`
        SELECT *
        FROM products
        ORDER BY
          CASE
            WHEN sort_order > 0 THEN 0
            ELSE 1
          END,
          sort_order ASC,
          rowid DESC
      `).all()
       .map(normalizeProduct);

    res.json({
      categories,
      products
    });
  }
);


app.put(
  "/admin-api/order/categories",
  requireAdmin,
  (req, res) => {
    const categories =
      Array.isArray(
        req.body.categories
      )
        ? req.body.categories
            .map(String)
        : [];

    if (!categories.length) {
      return res
        .status(400)
        .json({
          error:
            "Category order required"
        });
    }

    db.prepare(`
      INSERT INTO app_settings (
        key,
        value
      )
      VALUES (?, ?)
      ON CONFLICT(key)
      DO UPDATE SET
        value = excluded.value
    `).run(
      "category_order",
      JSON.stringify(categories)
    );

    res.json({
      ok: true,
      categories
    });
  }
);


app.put(
  "/admin-api/order/products",
  requireAdmin,
  (req, res) => {
    const ids =
      Array.isArray(req.body.ids)
        ? req.body.ids.map(String)
        : [];

    const scope =
      String(
        req.body.scope || "All"
      );

    if (!ids.length) {
      return res.json({
        ok: true
      });
    }

    const column =
      scope.toLowerCase() === "all"
        ? "sort_order"
        : "category_sort_order";

    const update =
      db.prepare(
        `UPDATE products
         SET ${column} = ?
         WHERE id = ?`
      );

    const transaction =
      db.transaction(items => {
        items.forEach(
          (id, index) => {
            update.run(
              index + 1,
              id
            );
          }
        );
      });

    transaction(ids);

    res.json({
      ok: true
    });
  }
);



/* ===============================
   R2 CREATOR VIDEO API
================================ */

function validVideoSlot(value) {
  const slot =
    Number(value);

  return (
    Number.isInteger(slot) &&
    slot >= 1 &&
    slot <= 4
  );
}


app.post(
  "/admin-api/products/:id/videos/:slot/presign",
  requireAdmin,
  async (req, res) => {
    try {
      const productId =
        String(req.params.id);

      const slot =
        Number(req.params.slot);

      if (!validVideoSlot(slot)) {
        return res
          .status(400)
          .json({
            error:
              "Invalid video slot"
          });
      }

      const product =
        productById(productId);

      if (!product) {
        return res
          .status(404)
          .json({
            error:
              "Product not found"
          });
      }

      const filename =
        String(
          req.body.filename ||
          "video.mp4"
        );

      const mime =
        String(
          req.body.mime ||
          "video/mp4"
        );

      if (
        !mime.startsWith(
          "video/"
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              "File must be a video"
          });
      }

      const rawExtension =
        path.extname(filename)
          .toLowerCase();

      const extension =
        /^[.][a-z0-9]{1,8}$/
          .test(rawExtension)
          ? rawExtension
          : ".mp4";

      const key =
        [
          "creator-videos",
          productId,
          `slot-${slot}-${crypto.randomUUID()}${extension}`
        ].join("/");

      const uploadUrl =
        await getSignedUrl(
          r2,

          new PutObjectCommand({
            Bucket:
              R2_BUCKET,

            Key:
              key,

            ContentType:
              mime
          }),

          {
            expiresIn: 15 * 60
          }
        );

      res.json({
        key,
        upload_url:
          uploadUrl
      });

    } catch (error) {
      console.error(
        "R2 presign error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not prepare video upload"
        });
    }
  }
);


app.post(
  "/admin-api/products/:id/videos/:slot/complete",
  requireAdmin,
  async (req, res) => {
    try {
      const productId =
        String(req.params.id);

      const slot =
        Number(req.params.slot);

      if (!validVideoSlot(slot)) {
        return res
          .status(400)
          .json({
            error:
              "Invalid video slot"
          });
      }

      const key =
        String(
          req.body.key || ""
        );

      const requiredPrefix =
        `creator-videos/${productId}/`;

      if (
        !key.startsWith(
          requiredPrefix
        )
      ) {
        return res
          .status(400)
          .json({
            error:
              "Invalid video key"
          });
      }

      const old =
        db.prepare(
          `SELECT video_key
           FROM product_videos
           WHERE product_id = ?
           AND slot = ?`
        ).get(
          productId,
          slot
        );

      db.prepare(`
        INSERT INTO product_videos (
          product_id,
          slot,
          video_blob,
          video_filename,
          video_mime,
          video_key,
          updated_at
        )

        VALUES (
          ?, ?,
          zeroblob(0),
          ?, ?, ?,
          CURRENT_TIMESTAMP
        )

        ON CONFLICT(
          product_id,
          slot
        )
        DO UPDATE SET
          video_blob =
            zeroblob(0),

          video_filename =
            excluded.video_filename,

          video_mime =
            excluded.video_mime,

          video_key =
            excluded.video_key,

          updated_at =
            CURRENT_TIMESTAMP
      `).run(
        productId,
        slot,
        String(
          req.body.filename ||
          ""
        ),
        String(
          req.body.mime ||
          "video/mp4"
        ),
        key
      );

      if (
        old?.video_key &&
        old.video_key !== key
      ) {
        try {
          await r2.send(
            new DeleteObjectCommand({
              Bucket:
                R2_BUCKET,

              Key:
                old.video_key
            })
          );
        } catch (error) {
          console.error(
            "Could not remove replaced R2 video:",
            error
          );
        }
      }

      res.json(
        productById(
          productId
        )
      );

    } catch (error) {
      console.error(
        "R2 completion error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not finish video upload"
        });
    }
  }
);


app.delete(
  "/admin-api/products/:id/videos/:slot",
  requireAdmin,
  async (req, res) => {
    try {
      const productId =
        String(req.params.id);

      const slot =
        Number(req.params.slot);

      if (!validVideoSlot(slot)) {
        return res
          .status(400)
          .json({
            error:
              "Invalid video slot"
          });
      }

      const row =
        db.prepare(
          `SELECT video_key
           FROM product_videos
           WHERE product_id = ?
           AND slot = ?`
        ).get(
          productId,
          slot
        );

      if (row?.video_key) {
        await r2.send(
          new DeleteObjectCommand({
            Bucket:
              R2_BUCKET,

            Key:
              row.video_key
          })
        );
      }

      db.prepare(
        `DELETE FROM product_videos
         WHERE product_id = ?
         AND slot = ?`
      ).run(
        productId,
        slot
      );

      res.json({
        ok: true
      });

    } catch (error) {
      console.error(
        "R2 delete error:",
        error
      );

      res
        .status(500)
        .json({
          error:
            "Could not remove video"
        });
    }
  }
);


/* ===============================
   ADMIN PRODUCT API
================================ */

app.get(
  "/admin-api/products",
  requireAdmin,
  (req, res) => {
    const rows =
      db.prepare(
        `SELECT *
         FROM products
         ORDER BY rowid DESC`
      ).all();

    res.json(
      rows.map(
        normalizeProduct
      )
    );
  }
);


app.post(
  "/admin-api/products",
  requireAdmin,
  upload.fields([
    {
      name: "image",
      maxCount: 1
    },
    {
      name: "video_1",
      maxCount: 1
    },
    {
      name: "video_2",
      maxCount: 1
    },
    {
      name: "video_3",
      maxCount: 1
    },
    {
      name: "video_4",
      maxCount: 1
    }
  ]),
  (req, res) => {
    const id =
      safeId(req.body.name);

    const active =
      String(req.body.active) ===
      "true"
        ? 1
        : 0;

    const imageFile =
      req.files?.image?.[0] ||
      null;

    db.prepare(`
      INSERT INTO products (
        id,
        name,
        brand,
        category,
        description,
        commission,
        shop_ads,
        free_sample,
        requirements,
        brand_website,
        image_blob,
        image_filename,
        image_mime,
        active
      )
      VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?
      )
    `).run(
      id,
      req.body.name || "",
      req.body.brand || "",
      req.body.category || "Other",
      req.body.description || "",
      req.body.commission || "0%",
      req.body.shop_ads || "—",

      req.body.free_sample ||
        "Auto-Approved",

      req.body.requirements ||
        "1 TikTok Shoppable Video",

      req.body.brand_website || "",

      imageFile?.buffer || null,
      imageFile?.originalname || null,
      imageFile?.mimetype || null,

      active
    );

    saveProductVideos(
      id,
      req.files,
      req.body
    );

    res.json(
      productById(id)
    );
  }
);


app.put(
  "/admin-api/products/:id",
  requireAdmin,
  upload.fields([
    {
      name: "image",
      maxCount: 1
    },
    {
      name: "video_1",
      maxCount: 1
    },
    {
      name: "video_2",
      maxCount: 1
    },
    {
      name: "video_3",
      maxCount: 1
    },
    {
      name: "video_4",
      maxCount: 1
    }
  ]),
  (req, res) => {
    const id =
      String(req.params.id);

    const current =
      productById(id);

    if (!current) {
      return res
        .status(404)
        .json({
          error: "Product not found"
        });
    }

    const active =
      String(req.body.active) ===
      "true"
        ? 1
        : 0;

    const imageFile =
      req.files?.image?.[0] ||
      null;

    if (imageFile) {
      db.prepare(`
        UPDATE products
        SET
          name = ?,
          brand = ?,
          category = ?,
          description = ?,
          commission = ?,
          shop_ads = ?,
          free_sample = ?,
          requirements = ?,
          brand_website = ?,
          image_blob = ?,
          image_filename = ?,
          image_mime = ?,
          image_url = NULL,
          active = ?,
          updated_at =
            CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        req.body.name || "",
        req.body.brand || "",
        req.body.category || "Other",
        req.body.description || "",
        req.body.commission || "0%",
        req.body.shop_ads || "—",

        req.body.free_sample ||
          "Auto-Approved",

        req.body.requirements ||
          "1 TikTok Shoppable Video",

        req.body.brand_website || "",

        imageFile.buffer,
        imageFile.originalname,
        imageFile.mimetype,

        active,
        id
      );

    } else {
      db.prepare(`
        UPDATE products
        SET
          name = ?,
          brand = ?,
          category = ?,
          description = ?,
          commission = ?,
          shop_ads = ?,
          free_sample = ?,
          requirements = ?,
          brand_website = ?,
          active = ?,
          updated_at =
            CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        req.body.name || "",
        req.body.brand || "",
        req.body.category || "Other",
        req.body.description || "",
        req.body.commission || "0%",
        req.body.shop_ads || "—",

        req.body.free_sample ||
          "Auto-Approved",

        req.body.requirements ||
          "1 TikTok Shoppable Video",

        req.body.brand_website || "",

        active,
        id
      );
    }

    saveProductVideos(
      id,
      req.files,
      req.body
    );

    res.json(
      productById(id)
    );
  }
);


app.delete(
  "/admin-api/products/:id",
  requireAdmin,
  (req, res) => {
    const id =
      String(req.params.id);

    db.prepare(
      `DELETE FROM product_videos
       WHERE product_id = ?`
    ).run(id);

    db.prepare(
      "DELETE FROM products WHERE id = ?"
    ).run(id);

    res.json({
      ok: true
    });
  }
);


/* ===============================
   ADMIN UI
================================ */

app.use(
  "/admin",
  express.static(
    path.resolve(
      __dirname,
      "public"
    )
  )
);

app.get(
  "/admin",
  (req, res) => {
    res.sendFile(
      path.resolve(
        __dirname,
        "public/index.html"
      )
    );
  }
);


app.listen(
  PORT,
  "127.0.0.1",
  () => {
    console.log(
      `✓ Partnerlinks Admin listening on http://127.0.0.1:${PORT}`
    );

    console.log(
      `✓ Using database: ${path.resolve(
        __dirname,
        "../creator-deals.db"
      )}`
    );
  }
);
