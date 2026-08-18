import express from "express";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import multer from "multer";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({
  path: path.resolve(__dirname, "../.env")
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

const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024
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

  return {
    ...safe,
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
  upload.single("image"),
  (req, res) => {
    const id =
      safeId(req.body.name);

    const active =
      String(req.body.active) ===
      "true"
        ? 1
        : 0;

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

      req.file?.buffer || null,
      req.file?.originalname || null,
      req.file?.mimetype || null,

      active
    );

    res.json(
      productById(id)
    );
  }
);


app.put(
  "/admin-api/products/:id",
  requireAdmin,
  upload.single("image"),
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

    if (req.file) {
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

        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,

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

    res.json(
      productById(id)
    );
  }
);


app.delete(
  "/admin-api/products/:id",
  requireAdmin,
  (req, res) => {
    db.prepare(
      "DELETE FROM products WHERE id = ?"
    ).run(
      String(req.params.id)
    );

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
