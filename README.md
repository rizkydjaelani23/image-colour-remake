# Image Colour Remake — Product Colour Visualiser for Shopify

A Shopify app that lets merchants show customers how their upholstered products (beds, sofas, chairs) look in any fabric colour — without photographing every combination. Upload a product image, mask the upholstery area, and generate realistic colour previews from fabric swatches.

## What it does

1. **Mask editor** — Draw, outline, or smart-select the upholstery area on any product image. Save multiple zones per product (headboard, base, cushions).
2. **Colour preview engine** — Upload a fabric swatch and the app composites it onto the product photo with realistic lighting, shadows, and texture. Supports smooth fabrics (plush, velvet) and textured fabrics (Venice, suede, Coniston).
3. **Bulk generation** — Select from recently used colours or upload new swatches, then generate previews in batches of 10. Queue summary shows exactly what will be processed.
4. **Preview Manager** — Browse, approve, and manage all generated previews. Toggle which previews appear on the storefront.
5. **Storefront gallery** — Theme app extension displays approved colour options on the product page via an app proxy. Customers can browse available colours without leaving the store.

## Tech stack

- **Framework:** React Router (Shopify app template)
- **Language:** TypeScript
- **Database:** PostgreSQL via Prisma ORM
- **Image processing:** Sharp (server-side compositing)
- **Storage:** Supabase (preview images and swatches)
- **Hosting:** Railway (auto-deploys from GitHub)
- **Auth:** Shopify App Bridge + session tokens
- **Billing:** Shopify Managed Pricing

## Project structure

```
app/
├── routes/
│   ├── app._index.tsx              # Dashboard — usage stats, recent previews
│   ├── app.visualiser.tsx          # Mask editor + colour preview generator
│   ├── app.previews.tsx            # Preview Manager
│   ├── api.generate-preview.ts     # Core image compositing engine
│   ├── api.save-mask.ts            # Save mask PNG to storage
│   ├── api.save-zone.ts            # Save zone metadata
│   ├── api.list-zones.ts           # List zones for a product
│   ├── api.delete-zone.ts          # Delete a zone
│   ├── api.rename-zone.ts          # Rename a zone
│   ├── api.previews.ts             # List/manage previews
│   ├── api.recent-swatches.ts      # Recently used colour swatches
│   ├── api.storefront-previews.ts  # App proxy for storefront gallery
│   ├── api.product-storefront-toggle.ts
│   ├── webhooks.compliance.ts      # GDPR compliance webhooks
│   └── auth.$.tsx                  # OAuth flow
├── shopify.server.ts               # Shopify app config + session storage
└── utils/
    ├── db.server.ts                # Prisma client
    ├── shop.server.ts              # Shop model helpers
    └── products.server.ts          # Product query helpers

extensions/
└── product-colour-gallery/         # Theme app extension for storefront

prisma/
└── schema.prisma                   # Database schema
```

## Setup

### Prerequisites

- Node.js 20+ (< 22 or >= 22.12)
- A Shopify Partner account and dev store
- A Supabase project (for image storage)
- Railway account (for hosting) or any Node.js host

### Install

```bash
git clone <your-repo-url>
cd image-colour-remake
npm install
```

### Environment variables

Create a `.env` file in the project root:

```env
SHOPIFY_API_KEY=your_api_key
SHOPIFY_API_SECRET=your_api_secret
SHOPIFY_APP_URL=https://your-production-url.up.railway.app
SHOPIFY_APP_HANDLE=image-colour-remake-2

DATABASE_URL=postgresql://user:password@host:port/dbname

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Database setup

```bash
npx prisma generate
npx prisma migrate deploy
```

### Local development

```bash
npm run dev
```

This starts the Shopify CLI dev server with a Cloudflare tunnel. Press `P` to open the app in your dev store.

### Deploy to production

Push to GitHub — Railway auto-deploys on every push:

```bash
git add .
git commit -m "your commit message"
git push
```

After Railway deploys, push any TOML config changes to Shopify:

```bash
npm run deploy
```

## Image compositing pipeline

The preview engine in `api.generate-preview.ts` works in several stages:

1. **Render mode detection** — Determines `smooth-colour` (plush/velvet) or `soft-texture` (Venice/suede) based on the fabric family name.
2. **Fabric layer creation** — Either a flat average-colour fill (smooth) or a distance-blurred swatch composite (textured).
3. **Lighting extraction** — Greyscale version of the original product image, normalized and masked, preserving natural light and shadow.
4. **Texture overlay** — Subtle swatch texture blended via soft-light to add fabric detail without overpowering the colour.
5. **Per-pixel blend** — Final compositing where the fabric layer replaces the original upholstery colour, respecting mask boundaries and preserving non-masked areas pixel-perfectly.

Key parameters: `blendStrength` (how much fabric colour shows through), `neutralMix` (how much original colour is neutralized to grey before blending), and `textureLight` linear offset (keeps texture overlay neutral rather than darkening).

## Shopify scopes

```
read_products, write_products
```

## Webhooks

- `app/uninstalled` — cleanup on uninstall
- `customers/data_request` — GDPR data request
- `customers/redact` — GDPR data deletion
- `shop/redact` — GDPR shop data deletion

## License

Private — not open source.
