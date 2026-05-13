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
    // Desktop and mobile preview toggles — read independently.
    // Liquid outputs "" for false booleans so we must use === "true".
    const showColourPreviewDesktop = root.dataset.showColourPreview === "true";
    const showColourPreviewMobile  = root.dataset.showColourPreviewMobile === "true";

    // Evaluated at click time so it responds correctly if the window is resized.
    function showColourPreview() {
      return window.matchMedia("(max-width: 749px)").matches
        ? showColourPreviewMobile
        : showColourPreviewDesktop;
    }

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

    // ── Main product image swap ───────────────────────────────────────────
    // Used when showColourPreview is false.
    // Strategy:
    //   1. Try theme-specific selectors (active slide first, then any product media)
    //   2. Fall back to the largest visible <img> on the page outside our widget
    // Handles <picture> elements by also clearing <source srcset> so the browser
    // can't override the img.src we set.
    var _originalMainMedia = null;

    // Returns true if an <img> is visible and large enough to be a main product image
    function isLargeVisibleImg(img) {
      if (!(img instanceof HTMLImageElement)) return false;
      var rect  = img.getBoundingClientRect();
      var style = window.getComputedStyle(img);
      return (
        rect.width  > 100 &&
        rect.height > 100 &&
        style.display    !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity    !== "0"
      );
    }

    // Returns true if the element is inside our gallery widget (don't swap those)
    function isInsideWidget(el) {
      var node = el;
      while (node) {
        if (node === root) return true;
        node = node.parentElement;
      }
      return false;
    }

    function getMainProductImage() {
      // ── 1. Theme-specific selectors (most precise — active/selected states first)
      var selectors = [
        // Active/selected slide states (common sliders)
        ".splide__slide.is-active img",
        ".swiper-slide-active img",
        ".slick-active img",
        ".flickity-is-selected img",
        // Dawn / Craft / Crave / Sense / Debut 2 (Shopify default themes)
        ".product__media-item.is-active img",
        ".product__media-item--single img",
        ".product__media-wrapper .is-active img",
        ".product__media img",
        // Prestige theme
        ".Product__MainImage img",
        ".product-gallery__image-wrapper.is-selected img",
        ".product-gallery__main img",
        // Empire / Editions theme
        ".product-photo-container img",
        ".product__photo--main img",
        // Impulse / Motion theme
        ".product__photo img",
        ".product-images .is-active img",
        ".product-images img",
        // Turbo theme
        ".product-image__container img",
        ".product_image-slide.is-active img",
        // Debut theme (classic)
        ".product-single__photo img",
        ".product-single__photos img",
        // Narrative / Simple / Express
        ".product-img-wrapper img",
        ".product__image img",
        // Pipeline / Palo Alto
        ".product-main-image img",
        ".product-main-photos img",
        // Broadcast / Fetch / Warehouse
        ".product__gallery-item.is-selected img",
        ".product__gallery-item.active img",
        ".product__image-wrapper img",
        // Generic catch-alls
        "[data-media-id] img",
        ".product-media img",
        ".product_image img",
        ".js-product-featured-image",
        "[data-zoom-image]",
      ];

      for (var i = 0; i < selectors.length; i++) {
        var images = Array.from(document.querySelectorAll(selectors[i]));
        var visible = images.find(function (img) {
          return isLargeVisibleImg(img) && !isInsideWidget(img);
        });
        if (visible) return visible;
      }

      // ── 2. Broad fallback: largest visible <img> on the page outside our widget
      // Search inside likely product containers first, then the whole page.
      var searchRoots = [
        document.querySelector('[data-section-type="product"]'),
        document.querySelector('[id*="shopify-section-"][id*="product"]'),
        document.querySelector("main"),
        document.body,
      ].filter(Boolean);

      for (var r = 0; r < searchRoots.length; r++) {
        var allImgs = Array.from(searchRoots[r].querySelectorAll("img"));
        var candidates = allImgs.filter(function (img) {
          return isLargeVisibleImg(img) && !isInsideWidget(img);
        });
        if (!candidates.length) continue;

        // Pick the largest by rendered area
        var best = candidates.reduce(function (a, b) {
          var ra = a.getBoundingClientRect();
          var rb = b.getBoundingClientRect();
          return (ra.width * ra.height >= rb.width * rb.height) ? a : b;
        });
        return best;
      }

      return null;
    }

    function captureOriginalMainMedia() {
      if (_originalMainMedia) return; // already saved
      var img = getMainProductImage();
      if (!img) return;
      // Also capture <source> elements inside a <picture> wrapper
      var sources = [];
      if (img.parentElement && img.parentElement.tagName === "PICTURE") {
        sources = Array.from(img.parentElement.querySelectorAll("source")).map(function (s) {
          return { el: s, srcset: s.getAttribute("srcset") || "", sizes: s.getAttribute("sizes") || "" };
        });
      }
      _originalMainMedia = {
        img:    img,
        src:    img.getAttribute("src")    || "",
        srcset: img.getAttribute("srcset") || "",
        sizes:  img.getAttribute("sizes")  || "",
        alt:    img.getAttribute("alt")    || "",
        sources: sources,
      };
    }

    function swapMainImage(url, isDeselect) {
      if (isDeselect || !url) {
        if (!_originalMainMedia) return;
        var img = _originalMainMedia.img || getMainProductImage();
        if (img) {
          img.src = _originalMainMedia.src;
          if (_originalMainMedia.srcset) img.setAttribute("srcset", _originalMainMedia.srcset);
          else img.removeAttribute("srcset");
          if (_originalMainMedia.sizes)  img.setAttribute("sizes",  _originalMainMedia.sizes);
          else img.removeAttribute("sizes");
          img.alt = _originalMainMedia.alt;
          // Restore <source> elements
          _originalMainMedia.sources.forEach(function (s) {
            if (s.srcset) s.el.setAttribute("srcset", s.srcset);
            else s.el.removeAttribute("srcset");
            if (s.sizes) s.el.setAttribute("sizes", s.sizes);
            else s.el.removeAttribute("sizes");
          });
        }
        _originalMainMedia = null;
        return;
      }

      captureOriginalMainMedia();
      var img = _originalMainMedia ? _originalMainMedia.img : getMainProductImage();
      if (!img) return;

      // Clear <source> srcsets so the browser uses our img.src (not the picture element srcset)
      if (img.parentElement && img.parentElement.tagName === "PICTURE") {
        Array.from(img.parentElement.querySelectorAll("source")).forEach(function (s) {
          s.removeAttribute("srcset");
          s.removeAttribute("sizes");
        });
      }

      img.src = shopifyImgUrl(url, 1200);
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
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
        if (!showColourPreview()) swapMainImage(null, true); // restore original main image
        return;
      }

      if (!showColourPreview()) {
        swapMainImage(match.imageUrl, false); // swap main image instead of inline panel
        return;
      }

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

              ${selectedPreview && showColourPreview() ? `
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

    // Capture the current main product image before first render so we can
    // restore it when the customer deselects a colour (original approach).
    if (!showColourPreview()) captureOriginalMainMedia();

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
