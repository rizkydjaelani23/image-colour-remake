import type { CSSProperties } from "react";
import type { LoaderFunctionArgs } from "react-router";
import { Link } from "react-router";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return {};
}

const pageStyle: CSSProperties = {
  padding: "28px",
  maxWidth: "860px",
  margin: "0 auto",
};

const sectionStyle: CSSProperties = {
  border: "1px solid #e5e7eb",
  borderRadius: "20px",
  background: "#ffffff",
  padding: "28px",
  marginBottom: "20px",
  boxShadow: "0 2px 8px rgba(15,23,42,0.04)",
};

const h2Style: CSSProperties = {
  margin: "0 0 6px 0",
  fontSize: "20px",
  fontWeight: 800,
  color: "#0f172a",
};

const leadStyle: CSSProperties = {
  margin: "0 0 20px 0",
  fontSize: "14px",
  color: "#64748b",
  lineHeight: 1.6,
};

const stepRowStyle: CSSProperties = {
  display: "flex",
  gap: "14px",
  alignItems: "flex-start",
  padding: "14px",
  borderRadius: "14px",
  background: "#f8fafc",
  border: "1px solid #e5e7eb",
  marginBottom: "10px",
};

const stepNumStyle: CSSProperties = {
  minWidth: "32px",
  height: "32px",
  borderRadius: "50%",
  background: "#0f172a",
  color: "#fff",
  fontSize: "13px",
  fontWeight: 800,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

const stepBodyStyle: CSSProperties = {
  flex: 1,
};

const stepTitleStyle: CSSProperties = {
  fontWeight: 700,
  fontSize: "14px",
  color: "#0f172a",
  marginBottom: "2px",
};

const stepTextStyle: CSSProperties = {
  fontSize: "13px",
  color: "#64748b",
  lineHeight: 1.5,
};

const calloutStyle: CSSProperties = {
  padding: "14px 16px",
  borderRadius: "14px",
  background: "#eef2ff",
  border: "1px solid #c7d2fe",
  fontSize: "14px",
  color: "#3730a3",
  fontWeight: 600,
  lineHeight: 1.6,
  marginTop: "16px",
};

const tipStyle: CSSProperties = {
  display: "flex",
  gap: "12px",
  padding: "14px",
  borderRadius: "14px",
  background: "#f0fdf4",
  border: "1px solid #bbf7d0",
  marginBottom: "10px",
  fontSize: "14px",
  color: "#166534",
  lineHeight: 1.5,
};

const faqQStyle: CSSProperties = {
  fontWeight: 700,
  fontSize: "14px",
  color: "#0f172a",
  marginBottom: "6px",
};

const faqAStyle: CSSProperties = {
  fontSize: "14px",
  color: "#475569",
  lineHeight: 1.6,
  marginBottom: "18px",
  paddingLeft: "14px",
  borderLeft: "3px solid #e2e8f0",
};

export default function InstructionsPage() {
  return (
    <div style={pageStyle}>
      <div style={{ marginBottom: "24px" }}>
        <h1 style={{ margin: "0 0 6px 0", fontSize: "28px", fontWeight: 800, color: "#0f172a" }}>
          Instructions
        </h1>
        <p style={{ margin: 0, fontSize: "15px", color: "#64748b", lineHeight: 1.6 }}>
          Everything you need to set up and get the most out of Image Colour Remake.
        </p>
      </div>

      {/* ── Workflow overview ── */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>How the app works</h2>
        <p style={leadStyle}>
          Five steps from a plain product photo to a live colour gallery on your store.
        </p>

        {[
          {
            title: "Select a product",
            text: "Open the Visualiser and pick the Shopify product you want to create colour previews for. Use a product with a light or white base for the most accurate results.",
          },
          {
            title: "Draw the fabric zone",
            text: "Paint over the upholstery or fabric area on the product image using the draw, outline, or smart-outline tool. The mask tells the app which part of the image should change colour.",
          },
          {
            title: "Save the zone",
            text: "Click Save zone to store the mask. You can save multiple zones per product (e.g. seat, back, arms) and switch between them.",
          },
          {
            title: "Upload swatches and generate previews",
            text: "Upload one swatch for a quick test, or use bulk upload to generate dozens at once. Use the folder upload option to auto-name colours by fabric family — just name your folder \"Plush\" and the files inside \"Maroon\", \"Navy\" etc.",
          },
          {
            title: "Approve previews and go live",
            text: "Go to the Preview Manager, review the generated images, and approve the ones you want customers to see. Only approved previews appear in the storefront gallery.",
          },
        ].map((step, i) => (
          <div key={step.title} style={stepRowStyle}>
            <div style={stepNumStyle}>{i + 1}</div>
            <div style={stepBodyStyle}>
              <div style={stepTitleStyle}>{step.title}</div>
              <div style={stepTextStyle}>{step.text}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Installing the storefront block ── */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Adding the colour gallery to your store</h2>
        <p style={leadStyle}>
          The gallery is a Shopify app block — you add it once to your product template and it
          automatically shows approved previews for each product.
        </p>

        {[
          {
            title: "Go to Online Store → Themes",
            text: "In your Shopify admin, click Online Store in the left sidebar, then Themes.",
          },
          {
            title: "Click Customize on your active theme",
            text: "Find your live theme and click the Customize button.",
          },
          {
            title: "Open a product template",
            text: "In the theme editor, navigate to a product page. You can use Products → Default product or any custom product template.",
          },
          {
            title: "Add the app block",
            text: 'Click Add block in the sidebar, then select Apps and choose Image Colour Remake from the list.',
          },
          {
            title: "Position the block",
            text: "Drag the block to where you want the gallery to appear — typically below the product images or above the Add to cart button.",
          },
          {
            title: "Save",
            text: "Click the Save button in the top-right of the theme editor.",
          },
          {
            title: "Check your product page",
            text: "Open a product that has approved previews. The colour gallery should appear automatically.",
          },
        ].map((step, i) => (
          <div key={step.title} style={stepRowStyle}>
            <div style={stepNumStyle}>{i + 1}</div>
            <div style={stepBodyStyle}>
              <div style={stepTitleStyle}>{step.title}</div>
              <div style={stepTextStyle}>{step.text}</div>
            </div>
          </div>
        ))}

        <div style={calloutStyle}>
          Only approved previews will appear on your storefront. If the gallery isn't showing,
          check that you have at least one approved preview for that product in the{" "}
          <Link to="/app/previews" style={{ color: "#4338ca" }}>Preview Manager</Link>.
        </div>
      </div>

      {/* ── Tips for best results ── */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Tips for the best results</h2>
        <p style={leadStyle}>Quick wins that make a big difference to preview quality.</p>

        {[
          {
            icon: "🎨",
            text: "Use products with a light or white base colour. The app blends the swatch colour into the existing texture — starting with a light neutral gives the most accurate and vibrant output.",
          },
          {
            icon: "📸",
            text: "Use high-resolution product images. The compositing algorithm works at pixel level — a sharp, well-lit product photo produces far more realistic results than a small or blurry one.",
          },
          {
            icon: "✏️",
            text: "Use Smart Outline for clean edges. This tool snaps your mask points to the edges detected in the image, giving a much cleaner result than freehand drawing.",
          },
          {
            icon: "📂",
            text: "Use the folder upload for bulk generation. Structure your swatches into folders named after the fabric family (e.g. Plush/, Velvet/) and the app will auto-name all colours for you.",
          },
          {
            icon: "🔤",
            text: "Name swatches well before uploading. The filename becomes the colour name customers see — use proper names like \"Plush Maroon\" rather than \"IMG_0042\".",
          },
          {
            icon: "✅",
            text: "Only approve your best previews. Customers see everything you approve — so it's better to show eight great previews than twenty mediocre ones.",
          },
        ].map((tip) => (
          <div key={tip.icon} style={tipStyle}>
            <span style={{ fontSize: "20px", lineHeight: 1 }}>{tip.icon}</span>
            <span>{tip.text}</span>
          </div>
        ))}
      </div>

      {/* ── FAQ ── */}
      <div style={sectionStyle}>
        <h2 style={h2Style}>Frequently asked questions</h2>
        <p style={leadStyle}>Common questions from merchants getting set up.</p>

        <div style={faqQStyle}>Why isn't the gallery showing on my product page?</div>
        <div style={faqAStyle}>
          Two things need to be true: (1) the app block must be added to your product template in
          the theme editor, and (2) the product must have at least one approved preview. Check
          both in the{" "}
          <Link to="/app/previews" style={{ color: "#4338ca" }}>Preview Manager</Link> and your theme
          customiser.
        </div>

        <div style={faqQStyle}>What image formats work best for swatches?</div>
        <div style={faqAStyle}>
          JPG or PNG both work. A square crop around 400×400 px or larger is ideal. Use a real
          photo of the fabric rather than a solid colour fill — the texture is what makes the
          previews look realistic.
        </div>

        <div style={faqQStyle}>Can I set up multiple zones on the same product?</div>
        <div style={faqAStyle}>
          Yes. In the Visualiser, draw a zone and save it, then clear the mask and draw a new one.
          Each saved zone is independent. When generating previews, the active zone determines
          which area of the product is coloured.
        </div>

        <div style={faqQStyle}>Can I re-generate a preview with an updated algorithm?</div>
        <div style={faqAStyle}>
          Yes — open the Visualiser, select the product and zone, pick the same swatch again, and
          hit Generate. A fresh preview is created. You can then go to the Preview Manager and
          approve the new one (and unapprove the old if needed).
        </div>

        <div style={faqQStyle}>How many swatches can I generate at once?</div>
        <div style={faqAStyle}>
          There is no hard cap on the queue, but previews are processed in batches of 10. On the
          Free plan you have 50 previews per billing cycle total. On the Pro plan generation is
          unlimited.
        </div>

        <div style={faqQStyle}>Why does the colour look different from my swatch photo?</div>
        <div style={faqAStyle}>
          The preview blends your swatch texture with the product's existing lighting and shadow.
          Bright photos and light-coloured products will show the most accurate colour. If the
          product image is dark or heavily shadowed, the colour will appear muted — this is
          intentional to keep the lighting realistic.
        </div>

        <div
          style={{
            padding: "16px",
            borderRadius: "14px",
            background: "#f8fafc",
            border: "1px solid #e5e7eb",
            fontSize: "14px",
            color: "#475569",
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: "#0f172a" }}>Need more help?</strong> Check out the{" "}
          <Link to="/app/storefront-preview-test" style={{ color: "#4338ca" }}>
            Storefront Test page
          </Link>{" "}
          to see how your gallery will look to customers before it goes live. Or head to the{" "}
          <Link to="/app/visualiser" style={{ color: "#4338ca" }}>Visualiser</Link> to start setting
          up your first product.
        </div>
      </div>
    </div>
  );
}
