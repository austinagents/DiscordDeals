let accessToken = null;

export function setAccessToken(token) {
  accessToken = token;
}

function isLocalDevelopment() {
  return (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  );
}

async function request(
  path,
  options = {}
) {
  const headers =
    new Headers(
      options.headers || {}
    );

  if (accessToken) {
    headers.set(
      "Authorization",
      `Bearer ${accessToken}`
    );
  }

  /*
   * Localhost convenience only.
   * Never sent from partnerlinks.app.
   */
  if (isLocalDevelopment()) {
    headers.set(
      "X-Creator-Deals-Dev",
      "1"
    );
  }

  const response =
    await fetch(path, {
      ...options,
      headers
    });

  const text =
    await response.text();

  let data = null;

  if (text) {
    try {
      data =
        JSON.parse(text);
    } catch {
      data = {
        message: text
      };
    }
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
      data?.message ||
      "Request failed"
    );
  }

  return data;
}

export const api = {
  me() {
    return request(
      "/api/me"
    );
  },

  products(category = "all") {
    return request(
      `/api/products?category=${encodeURIComponent(
        category
      )}`
    );
  },

  product(id) {
    return request(
      `/api/products/${encodeURIComponent(id)}`
    );
  },

  profile() {
    return request(
      "/api/profile"
    );
  },

  saveProfile(profile) {
    return request(
      "/api/profile",
      {
        method: "PUT",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify(profile)
      }
    );
  },

  requestProduct(productId) {
    return request(
      "/api/requests",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body:
          JSON.stringify({
            productId
          })
      }
    );
  },

  adminProducts() {
    return request(
      "/api/admin/products"
    );
  },

  createProduct(formData) {
    return request(
      "/api/admin/products",
      {
        method: "POST",
        body: formData
      }
    );
  },

  updateProduct(id, formData) {
    return request(
      `/api/admin/products/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        body: formData
      }
    );
  },

  deleteProduct(id) {
    return request(
      `/api/admin/products/${encodeURIComponent(id)}`,
      {
        method: "DELETE"
      }
    );
  }
};
