(function () {

  // ── Lazy / eager image loader ─────────────────────────────────────────────
  // activeObservers tracks every IntersectionObserver we create so we can
  // disconnect them all before rebuilding the DOM (family tab change / toggle).
  // Without this, old observers linger in memory pointing at detached nodes.
  var activeObservers = [];

  function disconnectObservers() {
    activeObservers.forEach(function (obs) { obs.disconnect(); });
    activeObservers = [];
  }

  function lazyLoadImages(container, eagerCount) {
    eagerCount = eagerCount || 4;
    const imgs = Array.from(container.querySelectorAll("img.pcg-lazy"));
    if (!imgs.length) return;

    imgs.forEach((img, i) => {
      if (i < eagerCount) {
        const src = img.dataset.src;
        if (src) {
          img.src = src;
          img.removeAttribute("data-src");
          if (i === 0) img.setAttribute("fetchpriority", "high");
        }
        return;
      }
      if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting) return;
              const el = entry.target;
              const src = el.dataset.src;
              if (src) { el.src = src; el.removeAttribute("data-src"); }
              observer.unobserve(el);
            });
          },
          { rootMargin: "80px" }
        );
        observer.observe(img);
        activeObservers.push(observer);
      } else {
        setTimeout(() => {
          const src = img.dataset.src;
          if (src) { img.src = src; img.removeAttribute("data-src"); }
        }, (i - eagerCount) * 60);
      }
    });
  }

  // ── Main gallery init ─────────────────────────────────────────────────────
  async function initColourGallery(root) {
    const numericProductId = root.dataset.productId;
    const shop             = root.dataset.shop;
    const heading            = root.dataset.heading          || "See this bed in other colours";
    const subtext            = root.dataset.subtext          || "Browse approved colour options for this product.";
    const collapsedLabel     = root.dataset.collapsedLabel   || "See more colours";
    const disclaimer         = root.dataset.disclaimer       || "";
    const showDisclaimer     = root.dataset.showDisclaimer   === "true";
    const openByDefault      = root.dataset.openByDefault    === "true";
    // Default true — only false when merchant explicitly sets it to false in theme editor
    const showColourPreview  = root.dataset.showColourPreview !== "false";

    if (!numericProductId || !shop) { root.innerHTML = ""; return; }

    const gidProductId = `gid://shopify/Product/${numericProductId}`;

    // Show skeleton immediately so space isn't blank while loading
    if (openByDefault) {
      root.innerHTML = `
        <div class="pcg-shell">
          <div class="pcg-toggle">
            <div class="pcg-toggle-copy">
              <span class="pcg-toggle-title">${escapeHtml(collapsedLabel)}</span>
              <span class="pcg-toggle-subtitle">${escapeHtml(subtext)}</span>
            </div>
            <span class="pcg-toggle-icon">−</span>
          </div>
          <div class="pcg-content">
            <div class="pcg-skeleton-row"></div>
            <div class="pcg-skeleton-grid">
              ${Array(4).fill('<div class="pcg-skeleton-card"></div>').join("")}
            </div>
          </div>
        </div>`;
    }

    // ── Fetch gallery data ────────────────────────────────────────────────
    // No sessionStorage — the HTTP Cache-Control header (max-age=120,
    // stale-while-revalidate=300) handles caching at the browser/CDN level.
    // sessionStorage caused merchants' changes (approve/hide) to not reflect
    // for the entire browser session, which broke the storefront toggle.
    let data;
    try {
      const response = await fetch(
        `/apps/colour-gallery?shop=${encodeURIComponent(shop)}&productId=${encodeURIComponent(gidProductId)}`
      );
      const rawText = await response.text();
      try { data = rawText ? JSON.parse(rawText) : null; }
      catch { throw new Error(`Non-JSON response: ${rawText || "empty"}`); }
      if (!response.ok) throw new Error((data && data.error) || "Failed to load previews");
      if (!data) throw new Error("Empty response from storefront previews API");
    } catch (error) {
      console.error("Product colour gallery error:", error);
      root.innerHTML = "";
      return;
    }

    const previews = Array.isArray(data.previews) ? data.previews : [];
    if (!previews.length) { root.innerHTML = ""; return; }

    const grouped = previews.reduce((acc, item) => {
      const family = item.fabricFamily || "General";
      if (!acc[family]) acc[family] = [];
      acc[family].push(item);
      return acc;
    }, {});

    const familyNames   = Object.keys(grouped);
    let activeFamily    = familyNames[0];
    let selectedPreview = null;
    let isExpanded      = openByDefault;

    // ── tap debounce ──────────────────────────────────────────────────────
    let tapping = false;
    function debounce(fn) {
      if (tapping) return;
      tapping = true;
      fn();
      setTimeout(() => { tapping = false; }, 400);
    }

    // ── colour preview panel (shown inside the gallery, no main image swap) ─
    // Works the same on desktop and mobile — CSS controls the size/layout.
    function applyCardSelection(match, isDeselect) {
      // Toggle active class on card buttons
      root.querySelectorAll(".pcg-card").forEach((btn) => {
        btn.classList.toggle(
          "is-active",
          !isDeselect && !!match && btn.dataset.previewId === match.id
        );
      });

      const existing = root.querySelector("#pcg-colour-preview");

      if (isDeselect || !match) {
        if (existing) existing.remove();
        return;
      }

      if (!showColourPreview) return; // merchant disabled the preview panel

      if (existing) {
        // Update in-place — no DOM recreation
        const img = existing.querySelector("img");
        if (img) { img.src = shopifyImgUrl(match.imageUrl, 600); img.alt = escapeHtml(match.colourName); }
        const label = existing.querySelector(".pcg-preview-label");
        if (label) label.innerHTML = `<span class="pcg-check">✓</span> ${escapeHtml(match.colourName)}`;
      } else {
        // Create once
        const panel = document.createElement("div");
        panel.className = "pcg-colour-preview";
        panel.id = "pcg-colour-preview";
        panel.innerHTML = `
          <img src="${escapeAttr(shopifyImgUrl(match.imageUrl, 600))}"
               alt="${escapeHtml(match.colourName)}"
               decoding="async" />
          <div class="pcg-preview-label">
            <span class="pcg-check">✓</span>${escapeHtml(match.colourName)}
          </div>`;
        // Insert above the grid
        const layout = root.querySelector(".pcg-gallery-layout");
        if (layout) layout.parentNode.insertBefore(panel, layout);
      }

      // Scroll into view so customers see the result without hunting for it
      const panel = root.querySelector("#pcg-colour-preview");
      if (panel) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    // ── full render (open/close and family change only) ───────────────────
    function render() {
      // Always clean up observers before wiping the DOM — prevents memory leaks
      // from detached IntersectionObserver instances on family/tab changes.
      disconnectObservers();

      const currentItems   = grouped[activeFamily] || [];
      const previousGrid   = root.querySelector(".pcg-side-grid");
      const previousScroll = previousGrid ? previousGrid.scrollTop : 0;

      root.innerHTML = `
        <div class="pcg-shell">
          <button
            type="button"
            class="pcg-toggle ${isExpanded ? "is-open" : ""}"
            aria-expanded="${isExpanded}"
          >
            <div class="pcg-toggle-copy">
              <span class="pcg-toggle-title">${escapeHtml(collapsedLabel)}</span>
              <span class="pcg-toggle-subtitle">${escapeHtml(subtext)}</span>
            </div>
            <span class="pcg-toggle-icon">${isExpanded ? "−" : "+"}</span>
          </button>

          ${isExpanded ? `
            <div class="pcg-content">
              <div class="pcg-header">
                <h3 class="pcg-heading">${escapeHtml(heading)}</h3>
                ${showDisclaimer && disclaimer
                  ? `<p class="pcg-disclaimer">${escapeHtml(disclaimer)}</p>`
                  : ""}
              </div>

              <div class="pcg-families">
                ${familyNames.map((f) => `
                  <button type="button"
                    class="pcg-family-button ${f === activeFamily ? "is-active" : ""}"
                    data-family="${escapeAttr(f)}"
                  >${escapeHtml(f)}</button>
                `).join("")}
              </div>

              ${selectedPreview && showColourPreview ? `
                <div class="pcg-colour-preview" id="pcg-colour-preview">
                  <img src="${escapeAttr(shopifyImgUrl(selectedPreview.imageUrl, 600))}"
                       alt="${escapeHtml(selectedPreview.colourName)}"
                       decoding="async" />
                  <div class="pcg-preview-label">
                    <span class="pcg-check">✓</span>${escapeHtml(selectedPreview.colourName)}
                  </div>
                </div>
              ` : ""}

              <div class="pcg-gallery-layout">
                <div class="pcg-side-column">
                  <div class="pcg-side-grid">
                    ${currentItems.map((item) => `
                      <button type="button"
                        class="pcg-card ${selectedPreview && item.id === selectedPreview.id ? "is-active" : ""}"
                        data-preview-id="${escapeAttr(item.id)}"
                      >
                        <img
                          class="pcg-lazy"
                          src=""
                          data-src="${escapeAttr(shopifyImgUrl(item.imageUrl, 120))}"
                          alt="${escapeHtml(item.colourName)}"
                          decoding="async"
                          width="90"
                          height="90"
                        />
                        <div class="pcg-card-title">${escapeHtml(item.colourName)}</div>
                      </button>
                    `).join("")}
                  </div>
                </div>
              </div>
            </div>
          ` : ""}
        </div>`;

      const toggleBtn = root.querySelector(".pcg-toggle");
      if (toggleBtn) {
        toggleBtn.addEventListener("click", () => {
          isExpanded = !isExpanded;
          render();
        });
      }

      if (isExpanded) {
        lazyLoadImages(root, 4);

        root.querySelectorAll(".pcg-family-button").forEach((btn) => {
          btn.addEventListener("click", () => {
            activeFamily = btn.dataset.family;
            selectedPreview = null;
            render();
          });
        });

        const items = grouped[activeFamily] || [];
        root.querySelectorAll(".pcg-card").forEach((btn) => {
          btn.addEventListener("click", () => {
            debounce(() => {
              const match = items.find((item) => item.id === btn.dataset.previewId);
              if (!match) return;

              if (selectedPreview && selectedPreview.id === match.id) {
                selectedPreview = null;
                applyCardSelection(null, true);
                return;
              }

              selectedPreview = match;
              applyCardSelection(match, false);
            });
          });
        });

        const newGrid = root.querySelector(".pcg-side-grid");
        if (newGrid) newGrid.scrollTop = previousScroll;
      }
    }

    render();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }
  function escapeAttr(value) { return escapeHtml(value); }

  // ── Shopify CDN image resizer ─────────────────────────────────────────────
  // Appends ?width=N to Shopify CDN URLs so the CDN serves a smaller image.
  // Falls back to the original URL for non-Shopify hosts (no breakage).
  function shopifyImgUrl(url, width) {
    if (!url || !url.includes("cdn.shopify.com")) return url;
    try {
      const u = new URL(url);
      u.searchParams.set("width", String(width));
      return u.toString();
    } catch (_) { return url; }
  }

  // ── Initialisation ────────────────────────────────────────────────────────
  // Uses data-pcg-ready to guard against double-init if this runs twice.
  // Checks readyState so it works whether the script loads before OR after
  // DOMContentLoaded — mobile browsers on slow connections often load scripts
  // later, causing DOMContentLoaded to fire before the listener is registered.
  function tryInit() {
    document.querySelectorAll(".pcg-root:not([data-pcg-ready])").forEach((el) => {
      el.setAttribute("data-pcg-ready", "");
      initColourGallery(el);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", tryInit);
  } else {
    // DOM already parsed — run immediately
    tryInit();
  }

})();
