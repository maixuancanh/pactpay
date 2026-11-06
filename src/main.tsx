import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Setup from "./Setup";
const NativeApp = React.lazy(() => import("./native/NativeApp"));
const ReceiptPage = React.lazy(() => import("./native/ReceiptPage"));
const BookingApp = React.lazy(() => import("./commerce/BookingApp"));
const EmbedCheckout = React.lazy(() => import("./embed/CheckoutPage"));
const ProtectedRoute = React.lazy(() => import("./payments/ProtectedRoute"));
const PublicIndexedReceipt = React.lazy(() => import("./commerce/PublicIndexedReceipt"));
const AccountExecutorPage = React.lazy(() => import("./payments/AccountExecutorPage"));
import "./style.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {location.pathname === '/account-executor' ? (
      <React.Suspense fallback={<main role="status">Loading account deployment…</main>}><AccountExecutorPage /></React.Suspense>
    ) : location.pathname === '/protected' ? (
      <React.Suspense fallback={<main role="status">Loading protected booking…</main>}><ProtectedRoute /></React.Suspense>
    ) : location.pathname === '/embed' ? (
      <React.Suspense fallback={<main role="status">Loading checkout…</main>}><EmbedCheckout /></React.Suspense>
    ) : (location.pathname === '/booking' || location.pathname === '/booking/profile') ? (
      <React.Suspense fallback={<main role="status">Loading your booking…</main>}><BookingApp /></React.Suspense>
    ) : location.pathname === "/native" || (import.meta.env.VITE_NATIVE_DEFAULT === 'true' && location.pathname === '/') ? (
      <React.Suspense fallback={<main className="setup-page" role="status">Loading native wallet workspace…</main>}><NativeApp /></React.Suspense>
    ) : location.pathname === "/receipt" ? (
      <React.Suspense fallback={<main role="status">Loading receipt…</main>}>{new URLSearchParams(location.search).has('quoteId')?<PublicIndexedReceipt/>:<ReceiptPage/>}</React.Suspense>
    ) : location.pathname === "/setup" ? (
      <Setup />
    ) : (
      <App />
    )}
  </React.StrictMode>,
);
