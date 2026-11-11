// Browser alerts over Web Push. Nexconn does not push to web browsers, so Pehle runs its own: the
// service worker at /sw.js shows what the server sends ({title, body, url, tag}) when a hold moves
// to you, a drop you asked about starts, or a shop you follow goes live. iPhones get these only
// after Pehle is added to the Home Screen.
import { useCallback, useEffect, useState } from "react";

import { api, unwrap } from "./api";

export type AlertsState =
  /** Checking what this browser supports. */
  | "checking"
  /** This browser has no Web Push. */
  | "unsupported"
  /** iPhone or iPad Safari: push works only from the Home Screen app. */
  | "install"
  /** The server has no push key configured. */
  | "unconfigured"
  /** The person blocked notifications for this site. */
  | "denied"
  /** Not asked yet, or asked and dismissed. */
  | "off"
  /** Subscribed and saved on the server. */
  | "on";

/** `pushManager.subscribe` wants the raw P-256 key bytes; the server gives base64url. */
export function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

let registration: Promise<ServiceWorkerRegistration> | null = null;

/** Register /sw.js once per tab. */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!registration) {
    registration = navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error: unknown) => {
      registration = null;
      throw error;
    });
  }
  return registration;
}

async function existingSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function save(subscription: PushSubscription) {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new Error("This browser returned an incomplete subscription.");
  await unwrap(api.POST("/api/v1/push/subscriptions", { body: { endpoint: json.endpoint, keys: { p256dh, auth } } }));
}

/** What this browser can do right now, before asking anything. */
export async function alertsState(pushKey: string | null | undefined): Promise<AlertsState> {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !isStandalone()) return "install";
  if (!pushSupported()) return "unsupported";
  if (!pushKey) return "unconfigured";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted" && (await existingSubscription())) return "on";
  return "off";
}

/**
 * Ask for permission (must run from a tap), subscribe with the server's VAPID key and save the
 * subscription for the signed-in person.
 */
export async function enableAlerts(pushKey: string): Promise<AlertsState> {
  if (!pushSupported()) return "unsupported";
  const permission = await Notification.requestPermission();
  if (permission === "denied") return "denied";
  if (permission !== "granted") return "off";
  const reg = await registerServiceWorker();
  await navigator.serviceWorker.ready;
  const key = urlBase64ToUint8Array(pushKey);
  let subscription = await reg.pushManager.getSubscription();
  // A subscription made with an older server key cannot receive our pushes.
  if (subscription) {
    const current = subscription.options.applicationServerKey;
    const same = current && new Uint8Array(current).every((b, i) => b === key[i]) && current.byteLength === key.byteLength;
    if (!same) {
      await subscription.unsubscribe().catch(() => undefined);
      subscription = null;
    }
  }
  subscription ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await save(subscription);
  return "on";
}

/**
 * Hook for alert buttons. When permission is already granted it quietly re-saves the subscription,
 * so alerts follow whoever is signed in on this device.
 */
export function useAlerts(pushKey: string | null | undefined, signedIn: boolean) {
  const [state, setState] = useState<AlertsState>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void alertsState(pushKey).then(async (s) => {
      if (cancelled) return;
      setState(s);
      if (s === "on" && signedIn) {
        const subscription = await existingSubscription().catch(() => null);
        if (subscription) await save(subscription).catch(() => undefined);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [pushKey, signedIn]);

  const enable = useCallback(async () => {
    if (!pushKey) return;
    setBusy(true);
    setError(null);
    try {
      setState(await enableAlerts(pushKey));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Alerts could not be turned on.");
    } finally {
      setBusy(false);
    }
  }, [pushKey]);

  return { state, busy, error, enable };
}
