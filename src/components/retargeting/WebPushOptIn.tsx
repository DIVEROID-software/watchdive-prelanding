import { useEffect, useState } from "react";
import type { Locale } from "../../lib/i18n/locale";
import type { PushPublicConfig } from "../../lib/push/config";
import {
  canOfferPush,
  decodeVapidPublicKey,
  PUSH_RECEIPT_KEY,
  savePushSubscription,
} from "../../lib/push/client";
import { PUSH_COPY } from "../../lib/push/copy";
import "./retargeting.css";
export function WebPushOptIn({ locale, config }: { locale: Locale; config: PushPublicConfig }) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [hasReceipt, setHasReceipt] = useState(false);
  const [message, setMessage] = useState("");
  const copy = PUSH_COPY[locale];
  useEffect(() => {
    setSupported(
      window.isSecureContext &&
        "Notification" in window &&
        "PushManager" in window &&
        "serviceWorker" in navigator,
    );
    try {
      const receipt = JSON.parse(localStorage.getItem(PUSH_RECEIPT_KEY) ?? "null");
      setHasReceipt(Boolean(receipt?.id && receipt?.receipt));
    } catch {
      /* no enabled claim */
    }
  }, []);
  // No registration, permission request, or subscription occurs on mount.
  const offered = canOfferPush(config, supported);
  if (!offered && !hasReceipt) return null;
  async function enable() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    let created: PushSubscription | null = null;
    let saved: { id: string; receipt: string } | null = null;
    try {
      // Must stay before the first awaited background operation: explicit click.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage(copy.denied);
        return;
      }
      const registration = await navigator.serviceWorker.register("/watchdive-push-sw.js", {
        scope: "/watchdive-push/",
      });
      const worker = registration.installing ?? registration.waiting;
      if (worker && worker.state !== "activated")
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            worker.removeEventListener("statechange", changed);
            reject(new Error("Worker activation timed out"));
          }, 10_000);
          function changed() {
            if (worker!.state === "activated" || worker!.state === "redundant") {
              clearTimeout(timer);
              worker!.removeEventListener("statechange", changed);
              if (worker!.state === "activated") resolve();
              else reject(new Error("Worker activation failed"));
            }
          }
          worker.addEventListener("statechange", changed);
          changed();
        });
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidPublicKey(config.publicKey!),
        }));
      if (!existing) created = subscription;
      saved = await savePushSubscription(subscription, locale);
      localStorage.setItem(PUSH_RECEIPT_KEY, JSON.stringify(saved));
      setHasReceipt(true);
      setEnabled(true);
      setMessage(copy.enabled);
    } catch {
      // Never show enabled if durable persistence or local revocation receipt failed.
      if (saved)
        await fetch("/api/push/subscription", {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(saved),
        }).catch(() => undefined);
      await created?.unsubscribe().catch(() => undefined);
      setMessage(copy.failed);
    } finally {
      setBusy(false);
    }
  }
  async function disable() {
    setBusy(true);
    try {
      const receipt = JSON.parse(localStorage.getItem(PUSH_RECEIPT_KEY) ?? "null");
      if (!receipt) throw new Error("Missing receipt");
      const response = await fetch("/api/push/subscription", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(receipt),
      });
      if (!response.ok) throw new Error("Removal failed");
      const registration = await navigator.serviceWorker?.getRegistration("/watchdive-push/");
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription && !(await subscription.unsubscribe()))
        throw new Error("Unsubscribe failed");
      localStorage.removeItem(PUSH_RECEIPT_KEY);
      setHasReceipt(false);
      setEnabled(false);
      setMessage(copy.off);
    } catch {
      setMessage(copy.failed);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="wd-push-optin" aria-label={copy.title}>
      <h2>{copy.title}</h2>
      <p>{copy.body}</p>
      {offered && !enabled && (
        <button type="button" disabled={busy} onClick={enable}>
          {busy ? copy.busy : copy.enable}
        </button>
      )}
      {hasReceipt && (
        <button type="button" disabled={busy} onClick={disable}>
          {busy ? copy.busy : copy.disable}
        </button>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
