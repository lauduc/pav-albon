/* Configuration de la commune, pour les pages publiques.
 *
 * Deux choses seulement : où joindre config.json, et comment fabriquer
 * l'adresse d'une photo. Le second point n'est pas un détail : c'est le seul
 * endroit du code qui sait que les photos sont aujourd'hui sur Google Drive.
 * Le jour où elles passent chez un hébergeur français, seuls les deux
 * gabarits de config.json changent.
 */

const VIDE = {
  commune:  { nom: "", departement: "" },
  adresses: { application: "", meteo: "" },
  photos:   { hebergeur: "", vue: "", vignette: "" },
  mentions: { source: "" },
};

let courante = VIDE;

/* Les pages météo vivent dans meteo/ : config.json est un cran au-dessus. */
export async function chargerConfig(chemin = "../config.json") {
  try {
    const r = await fetch(chemin, { cache: "no-cache" });
    if (r.ok) {
      const c = await r.json();
      if (c && c.commune) courante = { ...VIDE, ...c };
    }
  } catch {}   // une page sans configuration doit rester lisible
  return courante;
}

export const config = () => courante;

const remplir = (gabarit, id, largeur) => !gabarit || !id ? "" :
  gabarit.replace("{id}", encodeURIComponent(id)).replace("{largeur}", String(largeur || 600));

/* Adresse de la photo en grand, pour le lien. */
export const urlPhoto = id => remplir(courante.photos && courante.photos.vue, id);

/* Adresse de la vignette, pour l'affichage dans la page. */
export const urlVignette = (id, largeur) => remplir(courante.photos && courante.photos.vignette, id, largeur);

/* « Commune d'Albon (26) » — sans config, on n'écrit rien plutôt qu'un faux. */
export function libelleCommune(nom, departement) {
  const n = nom || (courante.commune && courante.commune.nom) || "";
  const d = departement || (courante.commune && courante.commune.departement) || "";
  if (!n) return "";
  const apostrophe = /^[AEIOUYÀÂÉÈÊÎÏÔÖÛÜ]/i.test(n) ? "Commune d'" : "Commune de ";
  return apostrophe + n + (d ? " (" + d + ")" : "");
}

/* Le barème vit dans son propre fichier : un futur écran de réglage n'aura
   que celui-là à réécrire, sans risquer de toucher à l'adresse du webhook ni
   au reste de la configuration de la commune. */
export async function chargerBareme(appliquer, chemin = "../bareme.json") {
  let brut;
  try {
    const r = await fetch(chemin, { cache: "no-cache" });
    if (r.ok) brut = await r.json();
  } catch {}   // fichier absent ou illisible : le barème par défaut s'applique
  return appliquer(brut);
}
