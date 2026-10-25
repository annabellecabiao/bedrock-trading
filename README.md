# Bedrock Consumer Goods Trading — Web Platform & API

A full-stack, containerized web platform for **Bedrock Consumer Goods Trading**, featuring premium Spanish wines (Rioja, Ribera del Duero, Utiel-Requena) and award-winning **BUENSALUD** Extra Virgin Olive Oils (Picual, Arbequina, Arbosana, Coupage, Empeltre, Frantoio) imported to the Philippines.

---

## 🌟 Upgraded Features

- **Database-Driven Product Catalog**: Dynamically loads wines and olive oils from a high-performance SQLite database with full CRUD capabilities.
- **Role-Based Authentication**:
  - **Admin**: Full access to the Admin Portal, product catalog editing, stock toggling, wholesale lead management, and customer order processing.
  - **Viewer**: Browse catalog, place orders, view order history, and manage personal profile.
- **Lead Capture & Contact Form**: Dedicated section for prospective restaurants, wholesale distributors, and retail partners to send inquiries directly into the database.
- **Integrated Shopping Cart & Checkout**: Place orders with Philippine address validation, multiple shipping rates (Standard, Express, Laguna Same-Day, Store Pick-Up), and payment methods (GCash, Maya, Bank Transfer, COD).
- **Admin Dashboard Portal (`/admin.html`)**:
  - Live metric statistics overview (Total products, new leads, active orders, registered users).
  - Product Inventory Manager (Add, edit, change prices, toggle stock in/out, delete).
  - Leads & Wholesale Inquiries Inbox (Filter by status: New, Contacted, Qualified, Closed).
  - Customer Orders Management (Track customer details, items, delivery, payment, and status).
  - User Directory & Role Assignment.
- **Containerization**:
  - Multi-stage Alpine `Dockerfile` optimized for production.
  - `docker-compose.yml` with persistent named volume for database persistence.
- **Azure Ready**:
  - Ready for **Azure Container Apps** and **Azure App Service (Web App for Containers)**.
  - Automated CI/CD pipeline via GitHub Actions.
  - Liveness/Readiness probe endpoint (`/health`).

---

## 🚀 Quick Start (Local Run)

### Option 1: Run with Node.js

```bash
# 1. Install dependencies
npm install

# 2. Seed initial products and admin account (done automatically on first start)
npm run seed

# 3. Start the application
npm start
```

Access the app at:
- **Main Website**: [http://localhost:8080](http://localhost:8080)
- **Admin Portal**: [http://localhost:8080/admin.html](http://localhost:8080/admin.html)
- **Health Check**: [http://localhost:8080/health](http://localhost:8080/health)

---

### Option 2: Run with Docker Compose

Ensure Docker Desktop is running, then execute:

```bash
docker compose up --build
```

The database volume (`bedrock_trading_data`) persists all product changes, orders, and leads even when the container restarts.

---

## 🔑 Default Credentials

On initial startup, two pre-configured accounts are created:

| Account Type | Email | Password | Role |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin@bedrocktrading.ph` | `AdminPassword123!` | `admin` |
| **Viewer** | `viewer@bedrocktrading.ph` | `ViewerPassword123!` | `viewer` |

> *Tip: You can customize these in `.env` before running.*

---

## ☁️ Azure Deployment

Refer to [`azure-deploy.md`](./azure-deploy.md) for full step-by-step instructions on deploying to **Azure Container Apps** or **Azure App Service** using Azure CLI, container registries (ACR), volume storage mounting, and custom domain setup.

---

## 📂 Project Structure

```
bedrock-trading/
├── .github/workflows/       # GitHub Actions CI/CD for Azure
│   └── azure-deploy.yml
├── data/                    # Persistent SQLite database storage (bedrock.db)
├── db/
│   ├── database.js          # SQLite connection, schema migrations, and auto-seeding
│   ├── seed-data.js         # Wine and olive oil catalog (auto-synced on admin edits/adds/deletions)
│   ├── sync-seed.js         # Automatic & programmatic synchronizer for seed-data.js
│   └── seed.js              # Standalone database verify/seed/sync script
├── images/                  # High-resolution wine and olive oil bottle images
├── middleware/
│   └── auth.js              # JWT authentication & role-based authorization
├── routes/
│   ├── auth.js              # Login, register, profile
│   ├── products.js          # Product catalog REST API
│   ├── leads.js             # Contact & wholesale inquiries REST API
│   ├── orders.js            # Cart checkout & order management REST API
│   └── users.js             # User account management REST API
├── .dockerignore
├── .env.example
├── admin.html               # Dedicated Admin Dashboard Portal
├── azure-deploy.md          # Comprehensive Azure deployment guide
├── Dockerfile               # Production multi-stage Alpine Dockerfile
├── docker-compose.yml       # Docker compose with persistent named volume
├── hero_banner.png          # Hero image
├── bedrock_logo.png         # Brand logo
├── index.css                # Spanish wine & gold design system
├── index.html               # Main customer website with dynamic catalog & auth
├── package.json             # NPM dependencies & scripts
└── server.js                # Express web server & static file host
```
