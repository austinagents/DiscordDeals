import React, {
  useEffect,
  useMemo,
  useState
} from "react";

import {
  createRoot
} from "react-dom/client";

import {
  initializeDiscord,
  openExternal
} from "./discord";

import {
  api,
  setAccessToken
} from "./api";

import "./style.css";


const CATEGORIES = [
  "All",
  "Fashion",
  "Food",
  "Sports",
  "Home",
  "Beauty",
  "Tech",
  "Other"
];


function App() {
  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [me, setMe] =
    useState(null);

  const [profile, setProfile] =
    useState(null);

  const [products, setProducts] =
    useState([]);

  const [category, setCategory] =
    useState("All");

  const [selected, setSelected] =
    useState(null);

  const [settingsOpen, setSettingsOpen] =
    useState(false);

  const [adminOpen, setAdminOpen] =
    useState(false);

  const [requestState, setRequestState] =
    useState(null);

  const [adminProducts, setAdminProducts] =
    useState([]);

  const [adminEditing, setAdminEditing] =
    useState(null);


  async function loadProducts(
    nextCategory = category
  ) {
    const rows =
      await api.products(
        nextCategory.toLowerCase()
      );

    setProducts(rows);
  }


  useEffect(() => {
    (async () => {
      try {
        const {
          accessToken
        } =
          await initializeDiscord();

        setAccessToken(
          accessToken
        );

        const [
          meData,
          profileData,
          productData
        ] =
          await Promise.all([
            api.me(),
            api.profile(),
            api.products("all")
          ]);

        setMe(meData);

        setProfile(
          profileData
        );

        setProducts(
          productData
        );
      } catch (err) {
        console.error(err);

        setError(
          err.message
        );
      } finally {
        setLoading(false);
      }
    })();
  }, []);


  async function chooseCategory(next) {
    setCategory(next);

    setSelected(null);

    await loadProducts(next);
  }


  async function beginRequest(product) {
    const latest =
      await api.profile();

    setProfile(latest);

    if (!latest?.tiktok_handle) {
      setRequestState({
        stage: "username",
        product
      });

      return;
    }

    setRequestState({
      stage: "confirm",
      product
    });
  }


  async function saveTikTok(handle) {
    let normalized =
      handle.trim();

    if (
      normalized &&
      !normalized.startsWith("@")
    ) {
      normalized =
        `@${normalized}`;
    }

    const updated =
      await api.saveProfile({
        ...profile,
        tiktok_handle:
          normalized
      });

    setProfile(updated);

    setRequestState({
      stage: "confirm",
      product:
        requestState.product
    });
  }


  async function confirmRequest() {
    const product =
      requestState.product;

    await api.requestProduct(
      product.id
    );

    setRequestState({
      stage: "submitted",
      product
    });
  }


  async function openAdmin() {
    setAdminOpen(true);

    setAdminEditing(null);

    setAdminProducts(
      await api.adminProducts()
    );
  }


  async function refreshAdmin() {
    setAdminProducts(
      await api.adminProducts()
    );

    await loadProducts(category);
  }


  if (loading) {
    return (
      <div className="center-screen">
        <div className="loader" />

        <h2>Creator Deals</h2>

        <p>
          Loading deals…
        </p>
      </div>
    );
  }


  if (error) {
    return (
      <div className="center-screen">
        <div className="error-icon">
          !
        </div>

        <h2>
          Creator Deals couldn't open
        </h2>

        <p>{error}</p>
      </div>
    );
  }


  return (
    <div className="app-shell">

      <header className="topbar">
        <div>
          <div className="eyebrow">
            UGC NETWORK
          </div>

          <h1>
            Creator Deals
          </h1>
        </div>

        <div className="top-actions">

          {me?.isAdmin && (
            <button
              className="icon-button"
              onClick={openAdmin}
              title="Admin"
            >
              ◈
            </button>
          )}

          <button
            className="icon-button"
            onClick={() =>
              setSettingsOpen(true)
            }
            title="Settings"
          >
            ⚙
          </button>

        </div>
      </header>


      {!selected && (
        <main className="content">

          <section className="hero">
            <div>
              <h2>
                Find products to promote
              </h2>

              <p>
                Exclusive brand deals
                available to creators.
              </p>
            </div>

            <div className="deal-count">
              {products.length}
              <span>
                Deals
              </span>
            </div>
          </section>


          <nav className="tabs">
            {CATEGORIES.map(
              item => (
                <button
                  key={item}
                  className={
                    category === item
                      ? "tab active"
                      : "tab"
                  }
                  onClick={() =>
                    chooseCategory(item)
                  }
                >
                  {item}
                </button>
              )
            )}
          </nav>


          {!products.length ? (
            <div className="empty-state">
              <div>
                📦
              </div>

              <h3>
                No deals here yet
              </h3>

              <p>
                Check another category.
              </p>
            </div>
          ) : (
            <div className="product-grid">

              {products.map(
                product => (
                  <ProductCard
                    key={
                      product.id
                    }
                    product={
                      product
                    }
                    onClick={() =>
                      setSelected(
                        product
                      )
                    }
                  />
                )
              )}

            </div>
          )}

        </main>
      )}


      {selected && (
        <ProductDetail
          product={selected}

          onBack={() =>
            setSelected(null)
          }

          onRequest={() =>
            beginRequest(
              selected
            )
          }
        />
      )}


      {settingsOpen && (
        <ProfileDrawer
          profile={profile}

          onClose={() =>
            setSettingsOpen(false)
          }

          onSave={async next => {
            const saved =
              await api.saveProfile(
                next
              );

            setProfile(saved);

            setSettingsOpen(
              false
            );
          }}
        />
      )}


      {requestState && (
        <RequestModal
          state={requestState}

          profile={profile}

          onClose={() =>
            setRequestState(null)
          }

          onSaveTikTok={
            saveTikTok
          }

          onConfirm={
            confirmRequest
          }
        />
      )}


      {adminOpen && (
        <AdminPanel
          products={
            adminProducts
          }

          editing={
            adminEditing
          }

          setEditing={
            setAdminEditing
          }

          onClose={() =>
            setAdminOpen(false)
          }

          refresh={
            refreshAdmin
          }
        />
      )}

    </div>
  );
}


function ProductCard({
  product,
  onClick
}) {
  const hasAds =
    product.shop_ads &&
    product.shop_ads !== "—";

  return (
    <button
      className="product-card"
      onClick={onClick}
    >
      <div className="product-image-wrap">
        <img
          className="product-image"
          src={
            `/api/products/${encodeURIComponent(
              product.id
            )}/image`
          }
          alt=""
        />

        <span className="sample-pill">
          Free Sample
        </span>
      </div>

      <div className="product-body">

        <div className="product-brand">
          {product.brand}
        </div>

        <h3>
          {product.name}
        </h3>

        <div className="metrics">

          <div>
            <span>
              Commission
            </span>

            <strong>
              {product.commission}
            </strong>
          </div>

          {hasAds && (
            <div>
              <span>
                Shop Ads
              </span>

              <strong>
                {product.shop_ads}
              </strong>
            </div>
          )}

        </div>

        <div className="card-footer">

          <span>
            {product.category}
          </span>

          <span className="view-link">
            View Deal →
          </span>

        </div>
      </div>
    </button>
  );
}


function ProductDetail({
  product,
  onBack,
  onRequest
}) {
  const hasAds =
    product.shop_ads &&
    product.shop_ads !== "—";

  return (
    <main className="detail-page">

      <button
        className="back-button"
        onClick={onBack}
      >
        ← Back to deals
      </button>


      <div className="detail-layout">

        <div className="detail-image-panel">
          <img
            src={
              `/api/products/${encodeURIComponent(
                product.id
              )}/image`
            }
            alt=""
          />
        </div>


        <section className="detail-info">

          <div className="category-label">
            {product.category}
          </div>

          <h2>
            {product.name}
          </h2>

          <div className="detail-brand">
            by {product.brand}
          </div>


          <div className="detail-metrics">

            <Metric
              label="Commission"
              value={
                product.commission
              }
            />

            {hasAds && (
              <Metric
                label="Shop Ads"
                value={
                  product.shop_ads
                }
              />
            )}

            <Metric
              label="Free Sample"
              value="Auto-Approved"
            />

          </div>


          <div className="detail-section">
            <h4>
              Description
            </h4>

            <p>
              {product.description ||
                "No description has been added yet."}
            </p>
          </div>


          <div className="requirement-card">
            <span>
              ⭐ Requirement
            </span>

            <strong>
              1 TikTok Shoppable Video
            </strong>
          </div>


          <div className="detail-buttons">

            <button
              className="primary-button"
              onClick={onRequest}
            >
              Request Product
            </button>


            {product.brand_website && (
              <button
                className="secondary-button"
                onClick={() =>
                  openExternal(
                    product.brand_website
                  )
                }
              >
                Brand Website ↗
              </button>
            )}

          </div>

        </section>
      </div>
    </main>
  );
}


function Metric({
  label,
  value
}) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}


function RequestModal({
  state,
  profile,
  onClose,
  onSaveTikTok,
  onConfirm
}) {
  const [handle, setHandle] =
    useState(
      profile?.tiktok_handle || ""
    );

  if (
    state.stage === "submitted"
  ) {
    return (
      <Modal onClose={onClose}>
        <div className="success-icon">
          ✓
        </div>

        <h2>
          Request Submitted
        </h2>

        <p>
          Your request for{" "}
          <strong>
            {state.product.name}
          </strong>{" "}
          has been sent.
        </p>

        <div className="next-card">
          <strong>
            What happens next?
          </strong>

          <span>
            The brand reviews
            your request.
          </span>

          <span>
            You'll be notified
            when a decision is made.
          </span>
        </div>

        <button
          className="primary-button"
          onClick={onClose}
        >
          Back to Deals
        </button>
      </Modal>
    );
  }


  if (
    state.stage === "username"
  ) {
    return (
      <Modal onClose={onClose}>

        <h2>
          Enter your social username
        </h2>

        <p>
          We'll save this for
          future requests.
        </p>

        <label className="field">
          <span>
            TikTok Username
          </span>

          <input
            value={handle}
            placeholder="@yourusername"
            onChange={e =>
              setHandle(
                e.target.value
              )
            }
          />
        </label>

        <button
          className="primary-button"
          disabled={
            !handle.trim()
          }
          onClick={() =>
            onSaveTikTok(
              handle
            )
          }
        >
          Continue
        </button>

      </Modal>
    );
  }


  return (
    <Modal onClose={onClose}>

      <h2>
        Confirm Request
      </h2>

      <p>
        Review your deal before
        submitting.
      </p>

      <div className="confirm-product">

        <img
          src={
            `/api/products/${encodeURIComponent(
              state.product.id
            )}/image`
          }
          alt=""
        />

        <div>
          <strong>
            {state.product.name}
          </strong>

          <span>
            {state.product.brand}
          </span>
        </div>

      </div>


      <div className="confirm-lines">

        <div>
          <span>
            Commission
          </span>

          <strong>
            {
              state.product
                .commission
            }
          </strong>
        </div>

        <div>
          <span>
            Free Sample
          </span>

          <strong>
            Auto-Approved
          </strong>
        </div>

        <div>
          <span>
            TikTok
          </span>

          <strong>
            {
              profile
                ?.tiktok_handle
            }
          </strong>
        </div>

        <div>
          <span>
            Requirement
          </span>

          <strong>
            1 TikTok Shoppable Video
          </strong>
        </div>

      </div>


      <button
        className="primary-button"
        onClick={onConfirm}
      >
        Confirm Request
      </button>

    </Modal>
  );
}


function ProfileDrawer({
  profile,
  onClose,
  onSave
}) {
  const [form, setForm] =
    useState({
      tiktok_handle:
        profile?.tiktok_handle || "",

      instagram_handle:
        profile?.instagram_handle || "",

      email:
        profile?.email || "",

      address:
        profile?.address || "",

      city:
        profile?.city || "",

      state:
        profile?.state || "",

      zip_code:
        profile?.zip_code || "",

      shirt_size:
        profile?.shirt_size || "",

      shoe_size:
        profile?.shoe_size || ""
    });


  function change(key, value) {
    setForm(current => ({
      ...current,
      [key]: value
    }));
  }


  return (
    <div className="drawer-backdrop">

      <aside className="drawer">

        <div className="drawer-header">
          <div>
            <div className="eyebrow">
              PROFILE
            </div>

            <h2>
              Settings
            </h2>
          </div>

          <button
            className="close-button"
            onClick={onClose}
          >
            ×
          </button>
        </div>


        <ProfileSection
          title="Social Accounts"
        >

          <Input
            label="TikTok"
            value={
              form.tiktok_handle
            }
            placeholder="@username"
            onChange={value =>
              change(
                "tiktok_handle",
                value
              )
            }
          />

          <Input
            label="Instagram"
            value={
              form.instagram_handle
            }
            placeholder="@username"
            onChange={value =>
              change(
                "instagram_handle",
                value
              )
            }
          />

        </ProfileSection>


        <ProfileSection
          title="Contact"
        >

          <Input
            label="Email"
            value={form.email}
            onChange={value =>
              change(
                "email",
                value
              )
            }
          />

        </ProfileSection>


        <ProfileSection
          title="Shipping"
        >

          <Input
            label="Address"
            value={form.address}
            onChange={value =>
              change(
                "address",
                value
              )
            }
          />

          <div className="two-column">
            <Input
              label="City"
              value={form.city}
              onChange={value =>
                change(
                  "city",
                  value
                )
              }
            />

            <Input
              label="State"
              value={form.state}
              onChange={value =>
                change(
                  "state",
                  value
                )
              }
            />
          </div>

          <Input
            label="ZIP Code"
            value={form.zip_code}
            onChange={value =>
              change(
                "zip_code",
                value
              )
            }
          />

        </ProfileSection>


        <ProfileSection
          title="Sizing"
        >

          <div className="two-column">

            <Input
              label="Shirt Size"
              value={
                form.shirt_size
              }
              onChange={value =>
                change(
                  "shirt_size",
                  value
                )
              }
            />

            <Input
              label="Shoe Size"
              value={
                form.shoe_size
              }
              onChange={value =>
                change(
                  "shoe_size",
                  value
                )
              }
            />

          </div>

        </ProfileSection>


        <button
          className="primary-button sticky-save"
          onClick={() =>
            onSave(form)
          }
        >
          Save Changes
        </button>

      </aside>
    </div>
  );
}


function ProfileSection({
  title,
  children
}) {
  return (
    <section className="profile-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}


function Input({
  label,
  value,
  onChange,
  placeholder = ""
}) {
  return (
    <label className="field">
      <span>{label}</span>

      <input
        value={value}
        placeholder={placeholder}
        onChange={e =>
          onChange(
            e.target.value
          )
        }
      />
    </label>
  );
}


function Modal({
  children,
  onClose
}) {
  return (
    <div className="modal-backdrop">

      <div className="modal">

        <button
          className="close-button modal-close"
          onClick={onClose}
        >
          ×
        </button>

        {children}

      </div>
    </div>
  );
}


function AdminPanel({
  products,
  editing,
  setEditing,
  onClose,
  refresh
}) {
  return (
    <div className="admin-overlay">

      <div className="admin-panel">

        <header className="admin-header">

          <div>
            <div className="eyebrow">
              ADMIN
            </div>

            <h2>
              Deals Manager
            </h2>
          </div>

          <div className="top-actions">

            <button
              className="primary-button small"
              onClick={() =>
                setEditing({
                  id: null
                })
              }
            >
              + Add Product
            </button>

            <button
              className="close-button"
              onClick={onClose}
            >
              ×
            </button>

          </div>

        </header>


        {!editing ? (
          <div className="admin-list">

            {products.map(product => (

              <div
                className="admin-row"
                key={product.id}
              >

                <img
                  src={
                    `/api/products/${encodeURIComponent(
                      product.id
                    )}/image`
                  }
                  alt=""
                />

                <div className="admin-row-main">

                  <strong>
                    {product.name}
                  </strong>

                  <span>
                    {product.brand}
                    {" • "}
                    {product.category}
                  </span>

                </div>

                <span
                  className={
                    product.active
                      ? "status active"
                      : "status"
                  }
                >
                  {product.active
                    ? "Active"
                    : "Disabled"}
                </span>

                <button
                  className="secondary-button small"
                  onClick={() =>
                    setEditing(
                      product
                    )
                  }
                >
                  Edit
                </button>

              </div>

            ))}

          </div>
        ) : (
          <AdminEditor
            product={editing}

            onCancel={() =>
              setEditing(null)
            }

            onSaved={async () => {
              setEditing(null);
              await refresh();
            }}
          />
        )}

      </div>
    </div>
  );
}


function AdminEditor({
  product,
  onCancel,
  onSaved
}) {
  const existing =
    Boolean(product?.id);

  const [form, setForm] =
    useState({
      name:
        product?.name || "",

      brand:
        product?.brand || "",

      category:
        product?.category ||
        "Fashion",

      description:
        product?.description || "",

      commission:
        product?.commission || "",

      shop_ads:
        product?.shop_ads === "—"
          ? ""
          : product?.shop_ads || "",

      brand_website:
        product?.brand_website ||
        "",

      active:
        product?.active !== 0
    });

  const [image, setImage] =
    useState(null);


  function change(key, value) {
    setForm(current => ({
      ...current,
      [key]: value
    }));
  }


  async function save() {
    const data =
      new FormData();

    Object.entries(form)
      .forEach(
        ([key, value]) => {
          data.append(
            key,
            String(value)
          );
        }
      );

    if (image) {
      data.append(
        "image",
        image
      );
    }

    if (existing) {
      await api.updateProduct(
        product.id,
        data
      );
    } else {
      await api.createProduct(
        data
      );
    }

    await onSaved();
  }


  async function remove() {
    if (!existing) return;

    if (
      !confirm(
        `Delete ${product.name}?`
      )
    ) {
      return;
    }

    await api.deleteProduct(
      product.id
    );

    await onSaved();
  }


  return (
    <div className="admin-editor">

      <button
        className="back-button"
        onClick={onCancel}
      >
        ← Products
      </button>


      <h3>
        {existing
          ? "Edit Product"
          : "Add Product"}
      </h3>


      <div className="admin-form-grid">

        <Input
          label="Product Name"
          value={form.name}
          onChange={value =>
            change(
              "name",
              value
            )
          }
        />

        <Input
          label="Brand"
          value={form.brand}
          onChange={value =>
            change(
              "brand",
              value
            )
          }
        />


        <label className="field">
          <span>Category</span>

          <select
            value={form.category}
            onChange={e =>
              change(
                "category",
                e.target.value
              )
            }
          >
            {CATEGORIES
              .filter(
                item =>
                  item !== "All"
              )
              .map(item => (
                <option
                  key={item}
                >
                  {item}
                </option>
              ))}
          </select>
        </label>


        <Input
          label="Commission"
          value={
            form.commission
          }
          placeholder="15%"
          onChange={value =>
            change(
              "commission",
              value
            )
          }
        />


        <Input
          label="Shop Ads"
          value={
            form.shop_ads
          }
          placeholder="5%"
          onChange={value =>
            change(
              "shop_ads",
              value
            )
          }
        />


        <Input
          label="Brand Website"
          value={
            form.brand_website
          }
          placeholder="https://..."
          onChange={value =>
            change(
              "brand_website",
              value
            )
          }
        />


        <label className="field full-width">
          <span>Description</span>

          <textarea
            value={
              form.description
            }
            onChange={e =>
              change(
                "description",
                e.target.value
              )
            }
          />
        </label>


        <label className="field full-width">
          <span>
            Product Image
          </span>

          <input
            type="file"
            accept="image/*"
            onChange={e =>
              setImage(
                e.target.files?.[0] ||
                null
              )
            }
          />
        </label>


        <label className="toggle-row full-width">

          <input
            type="checkbox"
            checked={form.active}
            onChange={e =>
              change(
                "active",
                e.target.checked
              )
            }
          />

          <span>
            Product Active
          </span>

        </label>

      </div>


      <div className="editor-actions">

        <button
          className="primary-button"
          onClick={save}
        >
          {existing
            ? "Save Product"
            : "Create Product"}
        </button>


        {existing && (
          <button
            className="danger-button"
            onClick={remove}
          >
            Delete Product
          </button>
        )}

      </div>

    </div>
  );
}


window.addEventListener("error", (event) => {
  console.error("CREATOR DEALS WINDOW ERROR:", event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("CREATOR DEALS UNHANDLED REJECTION:", event.reason);
});

console.log("=== CREATOR DEALS BOOT ===");
console.log("URL:", window.location.href);
console.log("Search:", window.location.search);
console.log("Inside iframe:", window.self !== window.top);
console.log("==========================");

function RootCrashBoundary() {
  const [fatalError, setFatalError] = React.useState(null);

  React.useEffect(() => {
    const onError = (event) => {
      setFatalError(
        event?.error?.stack ||
        event?.error?.message ||
        event?.message ||
        "Unknown frontend error"
      );
    };

    const onReject = (event) => {
      setFatalError(
        event?.reason?.stack ||
        event?.reason?.message ||
        String(event?.reason || "Unknown promise rejection")
      );
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onReject);

    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onReject);
    };
  }, []);

  if (fatalError) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#101116",
          color: "white",
          padding: "32px",
          fontFamily: "system-ui"
        }}
      >
        <h1>Creator Deals frontend error</h1>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            color: "#ff8c8c"
          }}
        >
          {fatalError}
        </pre>
      </div>
    );
  }

  return <App />;
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Missing #root element");
}

createRoot(root).render(
  <RootCrashBoundary />
);
