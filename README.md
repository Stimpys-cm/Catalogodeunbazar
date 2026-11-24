<div align="center">
  <img src="https://res.cloudinary.com/dendyzqsn/image/upload/v1784126788/banner_bazar_en_linea_kf5bcl.png" alt="Stiimpys banner" width="100%" />

  <h1>Stiimpys Store</h1>

  <p><strong>Full-stack e-commerce platform for a streetwear &amp; vintage shop in Reynosa, Mexico</strong></p>

  <p>
    <a href="https://stiimpys.store/"><strong>Live site</strong></a> ·
    <a href="#features">Features</a> ·
    <a href="#tech-stack">Tech stack</a> ·
    <a href="#architecture">Architecture</a> ·
    <a href="#getting-started">Getting started</a>
  </p>

  <p>
    <img alt="Node.js" src="https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white" />
    <img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black" />
    <img alt="MongoDB" src="https://img.shields.io/badge/MongoDB_Atlas-47A248?logo=mongodb&logoColor=white" />
    <img alt="Vercel" src="https://img.shields.io/badge/Vercel-000000?logo=vercel&logoColor=white" />
    <img alt="Cloudinary" src="https://img.shields.io/badge/Cloudinary-3448C5?logo=cloudinary&logoColor=white" />
    <img alt="Playwright" src="https://img.shields.io/badge/Tested_with-Playwright-2EAD33?logo=playwright&logoColor=white" />
  </p>
</div>

---

## Overview

**Stiimpys** is a personal project: a complete online store for streetwear and vintage clothing, published at stiimpys.store. It has a public storefront, a private admin dashboard for managing inventory and sales, online payments, shipping-label generation, automated Instagram publishing, and AI-assisted product listing.

I built it with the help of AI tools, and it has gone through 59 versions. Each version includes automated server and browser tests.

> 🇲🇽 *Proyecto personal: tienda en línea de streetwear y vintage, hecha con apoyo de herramientas de IA: catálogo público, panel de administración, pagos en línea, envíos, Instagram automático e IA para registrar prendas. La guía técnica en español está en [`docs/DESARROLLO.md`](docs/DESARROLLO.md).*

## Features

### Storefront
- Product catalog with filters by brand, category, size, price and drops, plus server-rendered landing pages for SEO
- Product detail pages, wishlist, reviews with photos, and "notify me" alerts
- Shopping cart and checkout with server-side price, discount and shipping calculation
- Customer accounts, order history, referral codes and personal coupons
- Installable on mobile as a **Progressive Web App**

### Payments & shipping
- Online payments with **Clip** and **PayPal**, plus bank transfers (SPEI) with receipt upload
- Items are reserved atomically before payment opens, so two buyers can never pay for the same piece
- Live shipping quotes, label generation and tracking through the **envia.com** API
- Email receipts via **Resend**

### Admin dashboard
- Inventory management with direct-to-Cloudinary photo uploads
- Point-of-sale mode with QR scanning for in-person sales
- Sales, statistics, activity log and audit trail
- Feature modules that can be switched on or off without a deploy

### AI & automation
- **Claude (Anthropic API)** drafts product listings from photos and researches comparable prices on the web
- AI spend tracking visible only to administrators
- Automated **Instagram** posts and vertical Reels (1080×1920 MP4 rendered in the browser with WebCodecs)
- A daily cron job handles scheduled posts, expired reservations, birthday coupons and shipment tracking
- Error alerts sent to Telegram or email

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS and vanilla JavaScript, bundled per page with **esbuild** |
| Backend | **Node.js** serverless functions on **Vercel**, plus Vercel Edge Middleware |
| Database | **MongoDB Atlas** |
| Media | **Cloudinary** (signed direct uploads) |
| Payments | Clip, PayPal, SPEI |
| Integrations | envia.com, Instagram Graph API, Anthropic API, Resend, Cloudflare Turnstile, Telegram |
| Testing | Node.js test runner with an in-memory MongoDB mock (`mingo`), **Playwright** browser tests |

## Architecture

```
Browser (storefront / admin PWA)
        │
        ▼
Vercel Edge Middleware ── hides admin routes and internal files, returns 404 to unauthenticated users
        │
        ▼
12 serverless API functions (/api) ── a shared security layer validates every request
        │
        ├── MongoDB Atlas     (products, orders, customers, sessions)
        ├── Cloudinary        (photos, receipts)
        └── External APIs     (Clip, PayPal, envia.com, Instagram, Anthropic, Resend)
```

The project fits the whole backend into **12 functions**, the limit of Vercel's free plan. Shared logic lives in `api/_lib/`, which doesn't count toward that limit.

```
/            Site pages (each .html is a route) and Vercel config
api/         Serverless functions; api/_lib/ holds shared server modules
css/, js/    Source styles and scripts (common / storefront / admin); dist/ is generated
herramientas/ Build scripts (bundling, theme generation)
pruebas/     Automated server and browser tests
docs/        Developer guide (Spanish) and version history
```

## Security highlights

- **Request shield** on every function: strips MongoDB operators and prototype keys, limits nested JSON, blocks cross-site writes (CSRF), allows only expected methods, and never leaks stack traces
- **Sessions** use `HttpOnly`, `Secure`, `SameSite=Lax` cookies, and admin tokens expire after 8 hours
- Passwords hashed with **bcrypt**, with rate limiting per connection and per account
- The admin panel is invisible without a session and returns the same 404 as any unknown route
- Prices, discounts and shipping are always computed on the server, and a payment only counts once the provider confirms it
- Uploads accept only signed image formats, so no SVG or HTML gets through
- Bot protection with Cloudflare Turnstile on sensitive forms

## Getting started

**Requirements:** Node.js 18 or newer, plus Python 3 with Playwright for the browser tests.

```bash
# Install dependencies
npm install

# Build the per-page CSS/JS bundles (run this after editing anything in css/ or js/)
npm run construir

# Run the server test suite (uses an in-memory database, so no real services are needed)
npm i --no-save mingo@6
npm run pruebas

# Start a local server with sample data at http://127.0.0.1:8766
node pruebas/correr.mjs --servidor
```

In production, configuration comes from environment variables set in Vercel: the database, Cloudinary, payment providers, shipping, Instagram and the AI keys. The full list is in [`docs/DESARROLLO.md`](docs/DESARROLLO.md#variables-de-entorno-en-vercel). Secrets are never committed to the repository.

## Testing

The `pruebas/` folder has **50+ test suites** that cover:

- Server logic: payments, reservations, coupons, permissions and AI endpoints
- Security: injection attempts, XSS, CSRF and hidden routes
- End-to-end browser flows with Playwright: cart, checkout, admin panel and Reel rendering
- A build check that fails if the generated bundles are out of date

## Author

Personal project by **[@Stimpys-cm](https://github.com/Stimpys-cm)**, a Multiplatform Software Development student, built with the help of AI tools as part of the learning process.

📫 Open to junior developer opportunities.
