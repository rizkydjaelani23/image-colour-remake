(function () {
  async function initColourGallery(root) {
    const numericProductId = root.dataset.productId;
    const shop = root.dataset.shop;
    const heading = root.dataset.heading || "See this bed in other colours";
    const subtext =
      root.dataset.subtext || "Browse approved colour options for this product.";
    const collapsedLabel = root.dataset.collapsedLabel || "See more colours";
    const disclaimer = root.dataset.disclaimer || "";
    const showDisclaimer = root.dataset.showDisclaimer === "true";
    const openByDefault = root.dataset.openByDefault === "true";

    if (!numericProductId || !shop) {
      root.innerHTML = "";
      return;
    }

    const gidProductId = `gid://shopify/Product/${numericProductId}`;

    try {
      const response = await fetch(
        `/apps/colour-gallery?shop=${encodeURIComponent(shop)}&productId=${encodeURIComponent(gidProductId)}`
      );

      const rawText = await response.text();

      let data;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch {
        throw new Error(`Non-JSON response received: ${rawText || "empty response"}`);
      }

      if (!response.ok) {
        throw new Error((data && data.error) || "Failed to load previews");
      }

      if (!data) {
        throw new Error("Empty response received from storefront previews API");
      }

      const previews = Array.isArray(data.previews) ? data.previews : [];

      if (!previews.length) {
        root.innerHTML = "";
        return;
      }

      const grouped = previews.reduce((acc, item) => {
        const family = item.fabricFamily || "General";
        if (!acc[family]) acc[family] = [];
        acc[family].push(item);
        return acc;
      }, {});

      const familyNames = Object.keys(grouped);
      let activeFamily = familyNames[0];
      let selectedPreview = null;
      let isExpanded = openByDefault;

      let originalMainMediaState = null;

      function getMainProductImage() {
        const selectors = [
          ".splide__slide.is-active img",
          ".swiper-slide-active img",
          ".product__media-wrapper .is-active img",
          ".product__media-item.is-active img",
          ".product__media img",
          '[data-media-id] img'
        ];

        for (const selector of selectors) {
          const images = Array.from(document.querySelectorAll(selector));

          const visibleImage = images.find((img) => {
            if (!(img instanceof HTMLImageElement)) return false;
            const rect = img.getBoundingClientRect();
            const style = window.getComputedStyle(img);

            return (
              rect.width > 40 &&
              rect.height > 40 &&
              style.display !== "none" &&
              style.visibility !== "hidden"
            );
          });

          if (visibleImage) return visibleImage;
        }

        return null;
      }

      function captureOriginalMainMedia() {
        const img = getMainProductImage();
        if (!img || originalMainMediaState) return;

        originalMainMediaState = {
          src: img.getAttribute("src") || "",
          srcset: img.getAttribute("srcset") || "",
          sizes: img.getAttribute("sizes") || "",
          alt: img.getAttribute("alt") || ""
        };
      }

      function restoreOriginalMainProductMedia() {
        const img = getMainProductImage();
        if (!img || !originalMainMediaState) return;

        img.src = originalMainMediaState.src || "";

        if (originalMainMediaState.srcset) {
          img.setAttribute("srcset", originalMainMediaState.srcset);
        } else {
          img.removeAttribute("srcset");
        }

        if (originalMainMediaState.sizes) {
          img.setAttribute("sizes", originalMainMediaState.sizes);
        } else {
          img.removeAttribute("sizes");
        }

        if (originalMainMediaState.alt) {
          img.alt = originalMainMediaState.alt;
        }
      }

      function swapMainProductMedia(preview) {
        if (!preview || !preview.imageUrl) return;

        const img = getMainProductImage();
        if (!img) return;

        captureOriginalMainMedia();

        img.src = preview.imageUrl;
        // Keep srcset/sizes so responsive image loading still works on mobile.
        // We update srcset to point to the same preview URL rather than removing it.
        if (img.hasAttribute("srcset")) {
          img.srcset = preview.imageUrl;
        }
        if (img.hasAttribute("sizes")) {
          img.sizes = "100vw";
        }

        if (preview.colourName) {
          img.alt = preview.colourName;
        }
      }

      function render() {
        const currentItems = grouped[activeFamily] || [];
        const previousGrid = root.querySelector(".pcg-side-grid");
        const previousScrollTop = previousGrid ? previousGrid.scrollTop : 0;

        root.innerHTML = `
          <div class="pcg-shell">
            <button
              type="button"
              class="pcg-toggle ${isExpanded ? "is-open" : ""}"
              aria-expanded="${isExpanded ? "true" : "false"}"
            >
              <div class="pcg-toggle-copy">
                <span class="pcg-toggle-title">${escapeHtml(collapsedLabel)}</span>
                <span class="pcg-toggle-subtitle">${escapeHtml(subtext)}</span>
              </div>
              <span class="pcg-toggle-icon">${isExpanded ? "−" : "+"}</span>
            </button>

            ${
              isExpanded
                ? `
              <div class="pcg-content">
                <div class="pcg-header">
                  <h3 class="pcg-heading">${escapeHtml(heading)}</h3>
                  ${showDisclaimer && disclaimer ? `<p class="pcg-disclaimer">${escapeHtml(disclaimer)}</p>` : ""}
                </div>

                <div class="pcg-families">
                  ${familyNames
                    .map(
                      (family) => `
                        <button
                          type="button"
                          class="pcg-family-button ${family === activeFamily ? "is-active" : ""}"
                          data-family="${escapeAttr(family)}"
                        >
                          ${escapeHtml(family)}
                        </button>
                      `
                    )
                    .join("")}
                </div>

                <div class="pcg-gallery-layout">
                  <div class="pcg-side-column">
                    <div class="pcg-side-grid">
                      ${currentItems
                        .map(
                          (item) => `
                            <button
                              type="button"
                              class="pcg-card ${selectedPreview && item.id === selectedPreview.id ? "is-active" : ""}"
                              data-preview-id="${escapeAttr(item.id)}"
                            >
                              <img src="${item.imageUrl}" alt="${escapeHtml(item.colourName)}" />
                              <div class="pcg-card-title">${escapeHtml(item.colourName)}</div>
                            </button>
                          `
                        )
                        .join("")}
                    </div>
                  </div>
                </div>
              </div>
            `
                : ""
            }
          </div>
        `;

        const toggleButton = root.querySelector(".pcg-toggle");
        if (toggleButton) {
          toggleButton.addEventListener("click", () => {
            isExpanded = !isExpanded;
            render();
          });
        }

        if (isExpanded) {
          root.querySelectorAll(".pcg-family-button").forEach((button) => {
            button.addEventListener("click", () => {
              activeFamily = button.dataset.family;
              selectedPreview = null;
              render();
              restoreOriginalMainProductMedia();
            });
          });

          root.querySelectorAll(".pcg-card").forEach((button) => {
            button.addEventListener("click", () => {
              const previewId = button.dataset.previewId;
              const match = currentItems.find((item) => item.id === previewId);
              if (!match) return;

              if (selectedPreview && selectedPreview.id === match.id) {
                selectedPreview = null;
                render();
                restoreOriginalMainProductMedia();
                return;
              }

              selectedPreview = match;
              render();
              swapMainProductMedia(match);
            });
          });

          const newGrid = root.querySelector(".pcg-side-grid");
          if (newGrid) {
            newGrid.scrollTop = previousScrollTop;
          }
        }
      }

      captureOriginalMainMedia();
      render();
    } catch (error) {
      console.error("Product colour gallery error:", error);
      root.innerHTML = "";
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
      document.querySelectorAll(".pcg-root").forEach(initColourGallery);
    }, 250);
  });
})();