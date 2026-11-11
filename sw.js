/* Service worker de la tournée PAV.
   Deux rôles, et un seul compte vraiment :

   1. Mettre la page en cache pour qu'elle s'ouvre au point suivant même sans
      réseau — en zone rurale c'est la règle, pas l'exception.
   2. Reprendre l'envoi des photos quand le téléphone est en veille ou la page
      fermée, via Background Sync.

   ⚠️ Background Sync n'existe que sur Chrome/Android. iOS ne l'implémente pas :
   là-bas, la file part au retour sur la page, pas avant. Le code le gère sans
   erreur, mais la promesse n'est pas la même selon le téléphone. */

const CACHE = "pav-v1";
const FICHIERS = ["./", "./index.html"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* Réseau d'abord : une nouvelle version déposée sur GitHub Pages doit arriver
   au prochain chargement. Le cache n'est qu'un filet pour le hors-ligne. */
self.addEventListener("fetch", e => {
  const r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(r)
      .then(rep => {
        const copie = rep.clone();
        caches.open(CACHE).then(c => c.put(r, copie)).catch(() => {});
        return rep;
      })
      .catch(() => caches.match(r).then(rep => rep || caches.match("./index.html")))
  );
});

/* ── accès à la file, partagée avec la page ─────────────────────────────── */

const DB = "pav", ST = "file", CFG = "config";

const idb = () => new Promise((ok, ko) => {
  const r = indexedDB.open(DB, 2);
  r.onupgradeneeded = () => {
    const d = r.result;
    if (!d.objectStoreNames.contains(ST))  d.createObjectStore(ST, { keyPath: "uuid" });
    if (!d.objectStoreNames.contains(CFG)) d.createObjectStore(CFG);
  };
  r.onsuccess = () => ok(r.result);
  r.onerror = () => ko(r.error);
});

const lire = (magasin, cle) => idb().then(d => new Promise((ok, ko) => {
  const t = d.transaction(magasin, "readonly");
  const q = cle === undefined ? t.objectStore(magasin).getAll() : t.objectStore(magasin).get(cle);
  q.onsuccess = () => ok(q.result);
  q.onerror = () => ko(q.error);
}));

const supprimer = cle => idb().then(d => new Promise((ok, ko) => {
  const t = d.transaction(ST, "readwrite");
  t.objectStore(ST).delete(cle);
  t.oncomplete = ok;
  t.onerror = () => ko(t.error);
}));

async function viderLaFile() {
  const endpoint = await lire(CFG, "endpoint");
  if (!endpoint) return;                       // rien de configuré : on ne tente rien
  const file = (await lire(ST)) || [];
  let envoyees = 0;
  for (const it of file) {
    const fd = new FormData();
    fd.append("photo", it.photo, it.uuid + ".jpg");
    for (const k of ["uuid", "horodatage", "site_code", "lat", "lon", "precision_m", "source"]) {
      if (it[k] !== undefined && it[k] !== null) fd.append(k, it[k]);
    }
    const r = await fetch(endpoint, { method: "POST", body: fd });
    // On laisse l'élément en file et on relance l'erreur : Background Sync
    // réessaiera tout seul plus tard, avec son propre délai.
    if (!r.ok) throw new Error("envoi refusé " + r.status);
    await supprimer(it.uuid);
    envoyees++;
  }
  if (envoyees) {
    const cs = await self.clients.matchAll();
    cs.forEach(c => c.postMessage({ type: "pav-envoye", n: envoyees }));
  }
}

self.addEventListener("sync", e => {
  if (e.tag === "envoi-pav") e.waitUntil(viderLaFile());
});

// Déclenchement manuel depuis la page, utile quand Background Sync est absent.
self.addEventListener("message", e => {
  if (e.data && e.data.type === "pav-vider") e.waitUntil(viderLaFile());
});
