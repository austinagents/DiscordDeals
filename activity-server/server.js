import express from "express";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import multer from "multer";
import path from "path";
import {
  fileURLToPath
} from "url";

dotenv.config({
  path:
    path.resolve(
      process.cwd(),
      "../.env"
    )
});

const __filename =
  fileURLToPath(
    import.meta.url
  );

const __dirname =
  path.dirname(__filename);

const DB_PATH =
  path.resolve(
    __dirname,
    "../creator-deals.db"
  );

const db =
  new Database(DB_PATH);

db.pragma(
  "journal_mode = WAL"
);

const app =
  express();

const PORT = 3001;

const upload =
  multer({
    storage:
      multer.memoryStorage(),

    limits: {
      fileSize:
        12 * 1024 * 1024
    }
  });

app.use(
  express.json({
    limit: "2mb"
  })
);


/* =========================================================
   DATABASE MIGRATIONS
========================================================= */

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
  const cols =
    columns(table);

  if (
    !cols.has(name)
  ) {
    db.exec(
      `ALTER TABLE ${table}
       ADD COLUMN ${definition}`
    );

    console.log(
      `✓ Added ${table}.${name}`
    );
  }
}


addColumn(
  "products",
  "description",
  "description TEXT NOT NULL DEFAULT ''"
);

addColumn(
  "products",
  "image_blob",
  "image_blob BLOB"
);

addColumn(
  "products",
  "image_filename",
  "image_filename TEXT"
);

addColumn(
  "products",
  "image_mime",
  "image_mime TEXT"
);

addColumn(
  "products",
  "image_url",
  "image_url TEXT"
);

addColumn(
  "creator_profiles",
  "instagram_handle",
  "instagram_handle TEXT"
);

addColumn(
  "creator_profiles",
  "email",
  "email TEXT"
);

addColumn(
  "creator_profiles",
  "address",
  "address TEXT"
);

addColumn(
  "creator_profiles",
  "city",
  "city TEXT"
);

addColumn(
  "creator_profiles",
  "state",
  "state TEXT"
);

addColumn(
  "creator_profiles",
  "zip_code",
  "zip_code TEXT"
);

addColumn(
  "creator_profiles",
  "shirt_size",
  "shirt_size TEXT"
);

addColumn(
  "creator_profiles",
  "shoe_size",
  "shoe_size TEXT"
);


/* =========================================================
   HELPERS
========================================================= */

function normalizeProduct(
  row
) {
  if (!row) return null;

  /*
   * Never serialize raw image bytes into product JSON.
   * Images are served separately by /api/products/:id/image.
   */
  const {
    image_blob,
    ...safeRow
  } = row;

  return {
    ...safeRow,

    active:
      Boolean(row.active),

    shop_ads:
      row.shop_ads &&
      row.shop_ads !== "null" &&
      row.shop_ads !== "undefined"
        ? row.shop_ads
        : "—",

    free_sample:
      "Auto-Approved",

    requirements:
      "1 TikTok Shoppable Video"
  };
}


function productById(id) {
  return normalizeProduct(
    db.prepare(
      `SELECT *
       FROM products
       WHERE id = ?`
    ).get(String(id))
  );
}


function safeId(name) {
  const base =
    String(name)
      .toLowerCase()
      .trim()
      .replace(
        /[^a-z0-9]+/g,
        "-"
      )
      .replace(
        /^-+|-+$/g,
        ""
      )
      .slice(0, 50) ||
    "product";

  let candidate =
    base;

  let n = 2;

  while (
    productById(
      candidate
    )
  ) {
    candidate =
      `${base}-${n++}`;
  }

  return candidate;
}


async function discordUser(
  accessToken
) {
  const response =
    await fetch(
      "https://discord.com/api/users/@me",
      {
        headers: {
          Authorization:
            `Bearer ${accessToken}`
        }
      }
    );

  if (!response.ok) {
    return null;
  }

  return response.json();
}


async function requireUser(
  req,
  res,
  next
) {
  try {
    /*
     * LOCAL ACTIVITY DEVELOPMENT
     *
     * Uses ADMIN_DISCORD_USER_ID as the current development
     * creator while we build/test the Activity UI.
     */
    if (
      req.headers[
        "x-creator-deals-dev"
      ] === "1"
    ) {
      const devUserId =
        process.env
          .ADMIN_DISCORD_USER_ID;

      if (!devUserId) {
        return res
          .status(500)
          .json({
            error:
              "ADMIN_DISCORD_USER_ID is missing"
          });
      }

      req.discordUser = {
        id:
          String(devUserId),

        username:
          "Austin",

        global_name:
          "Austin Taylor",

        avatar:
          null
      };

      req.developmentUser =
        true;

      return next();
    }

    /*
     * Production OAuth path stays available.
     */
    const auth =
      req.headers.authorization ||
      "";

    const token =
      auth.startsWith(
        "Bearer "
      )
        ? auth.slice(7)
        : null;

    if (!token) {
      return res
        .status(401)
        .json({
          error:
            "Missing access token"
        });
    }

    const user =
      await discordUser(token);

    if (!user) {
      return res
        .status(401)
        .json({
          error:
            "Invalid Discord session"
        });
    }

    req.discordUser =
      user;

    req.accessToken =
      token;

    next();

  } catch (error) {
    console.error(error);

    res
      .status(500)
      .json({
        error:
          "Authentication failed"
      });
  }
}


function requireAdmin(
  req,
  res,
  next
) {
  if (
    !process.env
      .ADMIN_DISCORD_USER_ID
  ) {
    return res
      .status(500)
      .json({
        error:
          "ADMIN_DISCORD_USER_ID not configured"
      });
  }

  if (
    String(
      req.discordUser.id
    ) !==
    String(
      process.env
        .ADMIN_DISCORD_USER_ID
    )
  ) {
    return res
      .status(403)
      .json({
        error:
          "Admin only"
      });
  }

  next();
}


/* =========================================================
   OAUTH
========================================================= */

app.post(
  "/api/token",
  async (req, res) => {
    try {
      const {
        code
      } = req.body;

      const response =
        await fetch(
          "https://discord.com/api/oauth2/token",
          {
            method:
              "POST",

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

                code
              })
          }
        );

      const data =
        await response.json();

      if (!response.ok) {
        console.error("DISCORD OAUTH ERROR");
        console.error("status:", response.status);
        console.error("response:", data);

        return res.status(400).json({
          error:
            data?.error_description ||
            data?.error ||
            "Discord OAuth failed"
        });
      }

      res.json({
        access_token:
          data.access_token
      });
    } catch (error) {
      console.error(error);

      res
        .status(500)
        .json({
          error:
            "OAuth token exchange failed"
        });
    }
  }
);


/* =========================================================
   CURRENT USER
========================================================= */

app.get(
  "/api/me",
  requireUser,
  (req, res) => {
    res.json({
      id:
        req.discordUser.id,

      username:
        req.discordUser.username,

      globalName:
        req.discordUser.global_name,

      avatar:
        req.discordUser.avatar,

      isAdmin:
        String(
          req.discordUser.id
        ) ===
        String(
          process.env
            .ADMIN_DISCORD_USER_ID
        )
    });
  }
);


/* =========================================================
   PRODUCTS
========================================================= */

app.get(
  "/api/products",
  requireUser,
  (req, res) => {
    const category =
      String(
        req.query.category ||
        "all"
      );

    let rows;

    if (
      category.toLowerCase() ===
      "all"
    ) {
      rows =
        db.prepare(
          `SELECT *
           FROM products
           WHERE active = 1
           ORDER BY rowid DESC`
        ).all();
    } else {
      rows =
        db.prepare(
          `SELECT *
           FROM products
           WHERE active = 1
           AND lower(category) =
               lower(?)
           ORDER BY rowid DESC`
        ).all(category);
    }

    res.json(
      rows.map(
        normalizeProduct
      )
    );
  }
);


app.get(
  "/api/products/:id",
  requireUser,
  (req, res) => {
    const product =
      productById(
        req.params.id
      );

    if (!product) {
      return res
        .status(404)
        .json({
          error:
            "Product not found"
        });
    }

    res.json(product);
  }
);


app.get(
  "/api/products/:id/image",
  (req, res) => {
    const row =
      db.prepare(
        `SELECT
           image_blob,
           image_filename,
           image_mime,
           image_url
         FROM products
         WHERE id = ?`
      )
      .get(
        String(
          req.params.id
        )
      );

    if (!row) {
      return res
        .sendStatus(404);
    }

    if (
      row.image_blob
    ) {
      res.setHeader(
        "Content-Type",
        row.image_mime ||
        "image/jpeg"
      );

      res.setHeader(
        "Cache-Control",
        "public,max-age=300"
      );

      return res.send(
        row.image_blob
      );
    }

    if (
      row.image_url
    ) {
      return res.redirect(
        row.image_url
      );
    }

    res.redirect(
      "https://cdn.discordapp.com/embed/avatars/0.png"
    );
  }
);


/* =========================================================
   CREATOR PROFILE
========================================================= */

app.get(
  "/api/profile",
  requireUser,
  (req, res) => {
    const userId =
      String(
        req.discordUser.id
      );

    let row =
      db.prepare(
        `SELECT *
         FROM creator_profiles
         WHERE discord_user_id = ?`
      ).get(userId);

    if (!row) {
      db.prepare(
        `INSERT INTO creator_profiles (
           discord_user_id
         )
         VALUES (?)`
      ).run(userId);

      row =
        db.prepare(
          `SELECT *
           FROM creator_profiles
           WHERE discord_user_id = ?`
        ).get(userId);
    }

    res.json(row);
  }
);


app.put(
  "/api/profile",
  requireUser,
  (req, res) => {
    const userId =
      String(
        req.discordUser.id
      );

    const values = {
      tiktok_handle:
        req.body
          .tiktok_handle ||
        null,

      instagram_handle:
        req.body
          .instagram_handle ||
        null,

      email:
        req.body.email ||
        null,

      address:
        req.body.address ||
        null,

      city:
        req.body.city ||
        null,

      state:
        req.body.state ||
        null,

      zip_code:
        req.body.zip_code ||
        null,

      shirt_size:
        req.body.shirt_size ||
        null,

      shoe_size:
        req.body.shoe_size ||
        null
    };

    db.prepare(`
      INSERT INTO creator_profiles (
        discord_user_id,
        tiktok_handle,
        instagram_handle,
        email,
        address,
        city,
        state,
        zip_code,
        shirt_size,
        shoe_size,
        updated_at
      )

      VALUES (
        @discord_user_id,
        @tiktok_handle,
        @instagram_handle,
        @email,
        @address,
        @city,
        @state,
        @zip_code,
        @shirt_size,
        @shoe_size,
        CURRENT_TIMESTAMP
      )

      ON CONFLICT(discord_user_id)
      DO UPDATE SET
        tiktok_handle =
          excluded.tiktok_handle,

        instagram_handle =
          excluded.instagram_handle,

        email =
          excluded.email,

        address =
          excluded.address,

        city =
          excluded.city,

        state =
          excluded.state,

        zip_code =
          excluded.zip_code,

        shirt_size =
          excluded.shirt_size,

        shoe_size =
          excluded.shoe_size,

        updated_at =
          CURRENT_TIMESTAMP
    `).run({
      discord_user_id:
        userId,
      ...values
    });

    const row =
      db.prepare(
        `SELECT *
         FROM creator_profiles
         WHERE discord_user_id = ?`
      ).get(userId);

    res.json(row);
  }
);


/* =========================================================
   PRODUCT REQUEST
========================================================= */

app.post(
  "/api/requests",
  requireUser,
  (req, res) => {
    const userId =
      String(
        req.discordUser.id
      );

    const product =
      productById(
        req.body.productId
      );

    if (
      !product ||
      !product.active
    ) {
      return res
        .status(404)
        .json({
          error:
            "Product unavailable"
        });
    }

    const profile =
      db.prepare(
        `SELECT *
         FROM creator_profiles
         WHERE discord_user_id = ?`
      ).get(userId);

    if (
      !profile?.tiktok_handle
    ) {
      return res
        .status(400)
        .json({
          error:
            "TikTok username required"
        });
    }

    const existing =
      db.prepare(
        `SELECT id
         FROM product_requests
         WHERE discord_user_id = ?
         AND product_id = ?
         LIMIT 1`
      )
      .get(
        userId,
        String(product.id)
      );

    if (existing) {
      return res
        .status(409)
        .json({
          error:
            "You already requested this product"
        });
    }

    const result =
      db.prepare(`
        INSERT INTO product_requests (
          discord_user_id,
          product_id,
          tiktok_handle,
          status
        )
        VALUES (?, ?, ?, 'pending')
      `).run(
        userId,
        String(product.id),
        profile.tiktok_handle
      );

    res.json({
      ok: true,

      requestId:
        result.lastInsertRowid
    });
  }
);


/* =========================================================
   ADMIN PRODUCTS
========================================================= */

app.get(
  "/api/admin/products",
  requireUser,
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
  "/api/admin/products",
  requireUser,
  requireAdmin,
  upload.single("image"),
  (req, res) => {
    const id =
      safeId(
        req.body.name
      );

    const active =
      String(
        req.body.active
      ) === "true"
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

      req.body.name,

      req.body.brand,

      req.body.category,

      req.body.description ||
      "",

      req.body.commission ||
      "0%",

      req.body.shop_ads ||
      "—",

      "Auto-Approved",

      "1 TikTok Shoppable Video",

      req.body.brand_website ||
      "",

      req.file?.buffer ||
      null,

      req.file?.originalname ||
      null,

      req.file?.mimetype ||
      null,

      active
    );

    res.json(
      productById(id)
    );
  }
);


app.put(
  "/api/admin/products/:id",
  requireUser,
  requireAdmin,
  upload.single("image"),
  (req, res) => {
    const id =
      String(
        req.params.id
      );

    const current =
      productById(id);

    if (!current) {
      return res
        .status(404)
        .json({
          error:
            "Product not found"
        });
    }

    const active =
      String(
        req.body.active
      ) === "true"
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
        req.body.name,
        req.body.brand,
        req.body.category,
        req.body.description || "",
        req.body.commission || "0%",
        req.body.shop_ads || "—",
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
          brand_website = ?,
          active = ?,
          updated_at =
            CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        req.body.name,
        req.body.brand,
        req.body.category,
        req.body.description || "",
        req.body.commission || "0%",
        req.body.shop_ads || "—",
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
  "/api/admin/products/:id",
  requireUser,
  requireAdmin,
  (req, res) => {
    db.prepare(
      `DELETE FROM products
       WHERE id = ?`
    ).run(
      String(
        req.params.id
      )
    );

    res.json({
      ok: true
    });
  }
);


/* =========================================================
   START
========================================================= */

app.listen(
  PORT,
  () => {
    console.log(
      `✓ Activity API listening on http://localhost:${PORT}`
    );

    console.log(
      `✓ Using database: ${DB_PATH}`
    );
  }
);
