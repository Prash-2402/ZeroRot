import { api, post } from "./api";

function b64ToUint8(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Registers the service worker, asks permission and stores the subscription on the backend. */
export async function enablePush(mobile = false) {
  if (!pushSupported()) throw new Error("This browser does not support web push");
  if (!window.isSecureContext) throw new Error("Push notifications need HTTPS (or localhost)");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("Notification permission was not granted");
  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const { public_key } = await api<{ public_key: string }>("/notifications/vapid", { mobile });
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(public_key) }));
  const j = sub.toJSON();
  await post("/notifications/subscribe", { endpoint: j.endpoint, keys: j.keys }, mobile);
  return true;
}

export const testPush = (mobile = false) => post("/notifications/test", {}, mobile);
