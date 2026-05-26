(function () {

  // ── Placeholder data-URIs ─────────────────────────────────────────────────
  // BLANK_GIF: transparent 1×1 used as the initial src so the browser never
  //   makes a GET to the page URL before data-src is swapped in.
  // GREY_SVG: solid #ebebeb 1×1 used when imageUrl is missing or the real
  //   image fails to load. Prevents the white broken-image rectangle that
  //   mobile Safari shows for failed <img> loads.
  var BLANK_GIF  = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
  var GREY_SVG   = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='1' height='1'%3E%3Crect width='1' height='1' fill='%23ebebeb'/%3E%3C/svg%3E";

  // ── Lazy / eager image loader ─────────────────────────────────────────────
  // activeObservers tracks every IntersectionObserver we create so we can
  // disconnect them all before rebuilding the DOM (family tab change / toggle).
  // Without this, old observers linger in memory pointing at detached nodes.
  var activeObservers = [];

  function disconnectObservers() {
    activeObservers.forEach(function (obs) { obs.disconnect(); });
    activeObservers = [];
  }

  // Load a single lazy image — swaps data-src → src and removes pcg-lazy when done.
  //
  // Three outcomes:
  //  1. data-src is empty (image not generated yet)
  //     → set GREY_SVG so the card shows a visible grey tile (not a white void)
  //  2. data-src is a valid URL that loads OK
  //     → onload removes pcg-lazy so the real image fades in
  //  3. data-src URL exists but fails (404/network error)
  //     → onerror swaps in GREY_SVG so mobile Safari doesn't show a white
  //        broken-image rectangle
  function loadImg(img) {
    var src = img.dataset.src;
    img.removeAttribute("data-src");

    if (!src) {
      // No image URL — stop shimmer immediately, grey tile shows via CSS background
      img.classList.remove("pcg-lazy");
      img.src = BLANK_GIF;
      return;
    }

    img.onload  = function () {
      img.classList.remove("pcg-lazy"); // stop shimmer, real image is ready
    };
    img.onerror = function () {
      // Null onerror FIRST to prevent an infinite loop if the fallback data URI
      // is blocked by the storefront CSP (e.g. data:image/svg+xml restrictions).
      // Use BLANK_GIF (data:image/gif — universally CSP-safe) instead of GREY_SVG;
      // the #ebebeb grey appearance already comes from the CSS background property.
      img.onerror = null;
      img.onload  = null;
      img.classList.remove("pcg-lazy"); // stop shimmer
      img.src = BLANK_GIF;             // transparent 1×1 — grey shows via CSS bg
    };
    img.src = src;
  }

  function lazyLoadImages(container, eagerCount) {
    eagerCount = eagerCount || 4;
    var imgs = Array.from(container.querySelectorAll("img.pcg-lazy"));
    if (!imgs.length) return;

    // On mobile, IntersectionObserver can silently fail to fire for images that
    // become visible inside a freshly-expanded container — the observer callback
    // is async and may not re-check after the layout settles on some mobile browsers.
    // Safest fix: load all images eagerly on mobile (no lazy-loading at all).
    // On desktop the grid has max-height:280px with overflow-y:auto, so only 2-3
    // rows are in view — IntersectionObserver is still worthwhile there.
    var isMobile = window.matchMedia("(max-width: 749px)").matches;

    imgs.forEach(function (img, i) {
      if (isMobile || i < eagerCount) {
        if (i === 0) img.setAttribute("fetchpriority", "high");
        loadImg(img);
        return;
      }
      if ("IntersectionObserver" in window) {
        var observer = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              if (!entry.isIntersecting) return;
              loadImg(entry.target);
              observer.unobserve(entry.target);
            });
          },
          { rootMargin: "120px" }
        );
        observer.observe(img);
        activeObservers.push(observer);
      } else {
        setTimeout(function () { loadImg(img); }, (i - eagerCount) * 60);
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

    // SEO add-on: use "{Product Name} in {Colour Name}" as alt text on every
    // preview image so Google can index fabric colour variations as real text.
    // Falls back to bare colour name when the add-on is not active.
    var seoEnabled   = data.seoEnabled === true;
    var productTitle = (data.product && data.product.title) || "";
    function seoAlt(colourName) {
      return seoEnabled && productTitle
        ? productTitle + " in " + colourName
        : colourName;
    }

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

    // Returns true if the element is inside a recommendations / upsell / cross-sell
    // section — these should never be treated as the main product image.
    function isInExcludedSection(el) {
      var patterns = [
        ".product-recommendations",
        ".complementary-products",
        ".related-products",
        ".recently-viewed",
        ".frequently-bought-together",
        "[data-section-type=\"product-recommendations\"]",
        "[data-section-type=\"related-products\"]",
        "[data-section-type=\"complementary-products\"]",
        "[data-section-type=\"cross-sell\"]",
        "[class*=\"recommendation\"]",
        "[class*=\"upsell\"]",
        "[class*=\"cross-sell\"]",
        "[class*=\"finish-the-look\"]",
        "[class*=\"related\"]",
        "[id*=\"recommendation\"]",
        "[id*=\"related-products\"]",
      ];
      for (var p = 0; p < patterns.length; p++) {
        try { if (el.closest(patterns[p])) return true; } catch (_) {}
      }
      return false;
    }

    // Walk up from our widget to find the nearest Shopify section ancestor.
    // Restricting the image search to this scope prevents us from accidentally
    // picking up images in other sections (e.g. "Finish the look" carousels).
    function getProductSectionRoot() {
      var node = root.parentElement;
      while (node && node !== document.body) {
        // Shopify wraps each section in a div with class "shopify-section"
        if (node.classList && node.classList.contains("shopify-section")) return node;
        // Some themes use data-section-type on the section itself
        if (node.dataset && node.dataset.sectionType) return node;
        node = node.parentElement;
      }
      return null;
    }

    function isGoodCandidate(img) {
      return isLargeVisibleImg(img) && !isInsideWidget(img) && !isInExcludedSection(img);
    }

    function getMainProductImage() {
      // ── 0. Determine the nearest .shopify-section ancestor so every search below
      //       is scoped to THIS product section only.  This prevents images in
      //       "Finish the look" / upsell sections (which are separate .shopify-section
      //       elements) from ever being returned, even if they share the same CSS classes.
      var productSection = getProductSectionRoot();

      // ── 1. Theme-specific selectors (most precise — active/selected states first)
      //       Search the section root first; fall back to document only when no
      //       section root could be found (should be extremely rare).
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

      // ── Pass A: search within scoped roots (prevents cross-section leakage).
      // Build an ordered list of candidate section roots to search.
      // We try the gallery's own .shopify-section first (works when the gallery
      // app block lives inside the product section), then fall back to other
      // heuristics for themes that render the gallery as a standalone app embed.
      var scopedRoots = [
        productSection,                                                         // gallery's own section
        document.querySelector('[data-section-type="product"]'),                // explicit product section
        document.querySelector('[data-section-type="main-product"]'),           // Dawn / OS2.0
        (function () {
          // Find a .shopify-section whose id contains "product" but NOT "recommendation"
          var all = Array.from(document.querySelectorAll(".shopify-section"));
          return all.find(function (s) {
            return /product/i.test(s.id) && !/recommend/i.test(s.id) && !/related/i.test(s.id);
          }) || null;
        })(),
      ].filter(Boolean);

      // Deduplicate so we don't search the same element twice
      var seenA = new Set();
      for (var r = 0; r < scopedRoots.length; r++) {
        if (seenA.has(scopedRoots[r])) continue;
        seenA.add(scopedRoots[r]);
        for (var i = 0; i < selectors.length; i++) {
          var images = Array.from(scopedRoots[r].querySelectorAll(selectors[i]));
          var visible = images.find(isGoodCandidate);
          if (visible) return visible;
        }
      }

      // ── Pass B: document-wide fallback.
      // All scoped searches failed. Fall back to the original document-wide search.
      // isGoodCandidate calls isInExcludedSection which filters known upsell patterns.
      // This ensures we never return null just because scoping rules were too strict.
      for (var i = 0; i < selectors.length; i++) {
        var images = Array.from(document.querySelectorAll(selectors[i]));
        var visible = images.find(isGoodCandidate);
        if (visible) return visible;
      }

      // ── 2. Broad fallback: largest visible <img> — scoped to our section first
      // productSection was already resolved above; reuse it here.
      // Never search the whole page; always start from the nearest section ancestor
      // so we don't accidentally pick up images in "Finish the look" / upsell sections.
      var searchRoots = [
        productSection,
        document.querySelector('[data-section-type="product"]'),
        document.querySelector('[data-section-type="main-product"]'),
        document.querySelector('[id*="shopify-section-"][id*="product"]'),
        // intentionally NOT including document.querySelector("main") or document.body
        // to avoid cross-section image leakage
      ].filter(Boolean);

      // Deduplicate — if productSection IS the shopify-section, no double search
      var seen = new Set();
      for (var r = 0; r < searchRoots.length; r++) {
        if (seen.has(searchRoots[r])) continue;
        seen.add(searchRoots[r]);

        var allImgs = Array.from(searchRoots[r].querySelectorAll("img"));
        var candidates = allImgs.filter(isGoodCandidate);
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

    function swapMainImage(url, isDeselect, colourName) {
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
      // SEO: label the swapped main image so Google knows which fabric/colour it shows
      if (seoEnabled && colourName) img.alt = seoAlt(colourName);
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
        if (!showColourPreview()) swapMainImage(null, true, null); // restore original main image
        return;
      }

      if (!showColourPreview()) {
        swapMainImage(match.imageUrl, false, match.colourName); // swap main image instead of inline panel
        return;
      }

      if (existing) {
        // Update in-place — no DOM recreation
        const img = existing.querySelector("img");
        if (img) { img.src = shopifyImgUrl(match.imageUrl, 600); img.alt = escapeHtml(seoAlt(match.colourName)); }
        const label = existing.querySelector(".pcg-preview-label");
        if (label) label.innerHTML = `<span class="pcg-check">✓</span> ${escapeHtml(match.colourName)}`;
      } else {
        // Create once
        const panel = document.createElement("div");
        panel.className = "pcg-colour-preview";
        panel.id = "pcg-colour-preview";
        panel.innerHTML = `
          <img src="${escapeAttr(shopifyImgUrl(match.imageUrl, 600))}"
               alt="${escapeHtml(seoAlt(match.colourName))}"
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
                       alt="${escapeHtml(seoAlt(selectedPreview.colourName))}"
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
                          src="${BLANK_GIF}"
                          data-src="${escapeAttr(item.imageUrl || "")}"
                          alt="${escapeHtml(seoAlt(item.colourName))}"
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
