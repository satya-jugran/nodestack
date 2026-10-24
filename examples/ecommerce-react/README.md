# 🛒 NodeStack E-Commerce React Demo

A modern, fast, full-featured retail storefront built with **React**, **Vite**, **Tailwind CSS**, and **`nodestack-client`**, connected directly to an embedded **NodeStack** backend.

---

## ⚡ Features

* 🔐 **Authentication**: User registration, login, JWT session management via `LocalAuthStore`, and **1-Click Demo Login** (`alex.vance@nodestack.dev`).
* 📦 **Product Catalog**: 20 pre-seeded products across 5 categories with SVG hero imagery, stock levels, and ratings.
* 🔍 **Search & Multi-Filters**: Instant client-side search, category pills, price & rating sorting, and "In Stock Only" toggle.
* ❤️ **Wishlist / Favorites**: Real-time favorite toggling synced with NodeStack's `favorites` collection (with guest fallback).
* 🛍️ **Slide-Over Cart Drawer**: Persistent cart stored in `localStorage`, quantity controls, and free shipping progress meter ($100 threshold).
* 💳 **Checkout Flow**: Submits orders directly to NodeStack's `orders` collection (`orderNumber`, `items` JSON, `total`, `shippingAddress`).
* 📜 **Past Orders & Tracking**: Visual order timeline (`Pending` $\rightarrow$ `Processing` $\rightarrow$ `Shipped` $\rightarrow$ `Delivered`) and items receipt breakdown.
* ⭐ **Customer Reviews**: View existing reviews and submit new ratings with **Verified Buyer** badges for previously purchased items.
* 📡 **Realtime SSE Subscriptions**: Listens to server change streams (`client.collection('products').subscribe('*')`) to update UI live when stock changes.

---

## 🚀 Quick Start

### 1. Launch the Backend Server (with E-Commerce Starter Template)

From the root repository directory:
```bash
npm start -- --template ecommerce
```
* **API & Realtime**: `http://localhost:8090/api/`
* **Admin Dashboard**: `http://localhost:8090/_/`

---

### 2. Launch the React Storefront

From the `examples/ecommerce-react` directory:
```bash
cd examples/ecommerce-react
npm run dev
```

Visit **`http://localhost:5173`** to use the storefront!

---

### 3. Environment Variables (Optional)

If your NodeStack server is running on a different port or host, create `.env.local`:
```env
VITE_NODESTACK_URL=http://localhost:8090
```
