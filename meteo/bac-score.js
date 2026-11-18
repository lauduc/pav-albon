/* Bac-Score — le calcul, et rien que le calcul.
 *
 * Ce module est la SEULE implémentation de la note. La page détaillée et la
 * vignette l'importent toutes les deux : si le barème change ici, il change
 * aux deux endroits le même jour. Aucune dépendance au DOM, aucun style —
 * de quoi le charger aussi ailleurs (autre commune, autre page) sans rien
 * emporter d'une commune en particulier avec lui.
 *
 * Les données brutes viennent de donnees.json, publié depuis le classeur.
 */

/* ── Le barème ─────────────────────────────────────────────────────────────
   Tout ce qu'une commune peut vouloir régler est ici, sous forme de données.
   Rien de ce qui suit n'est écrit en dur ailleurs : la page d'explication est
   elle-même fabriquée à partir de ces valeurs (voir decrireBareme), de sorte
   qu'un barème modifié ne puisse pas être démenti par le texte qui l'explique.

   Trois critères donnent des points de pénalité, le total donne une lettre.
   Chaque critère est une liste de paliers ordonnés ; le dernier est ouvert
   (seuil null = « et au-delà »).

   Un barème se change à chaud : appliquerBareme(objet) puis on recalcule.
   C'est ce qui permettra d'y adosser un écran de réglage qui montre l'effet
   sur les notes réelles avant d'enregistrer quoi que ce soit. */

export const BAREME_DEFAUT = {
  version: 1,
  lettres: [
    { l:"A", max:1,    lab:"Impeccable",  desc:"rien au sol, conteneurs disponibles" },
    { l:"B", max:3,    lab:"Bon",         desc:"incident isolé ou léger" },
    { l:"C", max:6,    lab:"Moyen",       desc:"dépôts qui reviennent ou saturation partielle" },
    { l:"D", max:9,    lab:"Dégradé",     desc:"dépôts réguliers ou conteneurs souvent pleins" },
    { l:"E", max:null, lab:"Point noir",  desc:"dépôts massifs ou récidive chaque semaine" },
  ],
  /* Déchets posés au sol, comptés en sacs par le classifieur. */
  proprete: {
    libelle: "Propreté au sol",
    paliers: [ {max:0,points:0}, {max:2,points:2}, {max:4,points:4}, {max:null,points:6} ],
    /* Un dépôt constaté sans sac dénombrable (cartons, encombrants) : on ne
       peut pas le classer à zéro, il prend le premier palier non nul. */
    depotSansSac: 2,
  },
  /* Part des conteneurs pleins ou bloqués, de 0 à 1. */
  remplissage: {
    libelle: "Remplissage",
    inaccessible: 4,
    paliers: [ {max:0,points:0}, {max:1/3,points:1}, {max:2/3,points:2}, {max:null,points:4} ],
  },
  /* Nombre de passages avec dépôt au sol dans la fenêtre, le relevé compris. */
  recidive: {
    libelle: "Récidive",
    fenetreJours: 30,
    paliers: [ {max:0,points:0}, {max:1,points:1}, {max:3,points:2}, {max:null,points:4} ],
  },
  /* Plusieurs photos du même dépôt prises coup sur coup sont UN passage :
     sinon le score récompenserait la parcimonie en photos. */
  passage: { minutes: 20 },
  /* Comment on remonte du flux à l'îlot, puis de l'îlot à la commune. */
  agregation: { ilot: "max", commune: "moyenne" },
};

/* Présentation : attachée à la lettre, pas réglable par la commune. */
const STYLE_LETTRE = {
  A:{var:"--sA",fill:.12}, B:{var:"--sB",fill:.32}, C:{var:"--sC",fill:.56},
  D:{var:"--sD",fill:.8},  E:{var:"--sE",fill:1},
};
const STYLE_SECOURS = [.12,.32,.56,.8,1];

const nombre = (v,d) => Number.isFinite(Number(v)) ? Number(v) : d;
const positif = (v,d) => { const n=nombre(v,NaN); return Number.isFinite(n)&&n>=0 ? n : d; };

/* Un escalier valide : seuils strictement croissants, dernier palier ouvert,
   points positifs. Tout ce qui ne l'est pas est écarté ; si rien ne survit on
   reprend la valeur par défaut, car une note sans barème n'a aucun sens. */
function paliersValides(brut, defaut, problemes, ou) {
  if (!Array.isArray(brut) || !brut.length) { if (brut !== undefined) problemes.push(ou+" : liste de paliers absente ou vide"); return defaut; }
  const out = [];
  let precedent = -Infinity;
  for (const p of brut) {
    const ouvert = p && (p.max === null || p.max === undefined || p.max === "");
    const seuil = ouvert ? null : nombre(p && p.max, NaN);
    const pts = positif(p && p.points, NaN);
    if (!Number.isFinite(pts)) { problemes.push(ou+" : un palier sans points chiffrés a été ignoré"); continue; }
    if (!ouvert && (!Number.isFinite(seuil) || seuil <= precedent)) { problemes.push(ou+" : seuil « "+(p&&p.max)+" » hors d'ordre, palier ignoré"); continue; }
    out.push({ max: ouvert ? null : seuil, points: pts });
    if (ouvert) break;                       // rien après le palier ouvert
    precedent = seuil;
  }
  if (!out.length) { problemes.push(ou+" : aucun palier exploitable, barème par défaut repris"); return defaut; }
  if (out[out.length-1].max !== null) {      // toujours finir par un palier ouvert
    problemes.push(ou+" : dernier palier fermé, il a été ouvert");
    out[out.length-1] = { max: null, points: out[out.length-1].points };
  }
  return out;
}

function lettresValides(brut, problemes) {
  if (!Array.isArray(brut) || brut.length < 2) { if (brut !== undefined) problemes.push("lettres : il en faut au moins deux, échelle par défaut reprise"); return BAREME_DEFAUT.lettres.map(x=>({...x})); }
  const out = []; let precedent = -Infinity;
  brut.forEach((x,i) => {
    const l = String(x && x.l || "").trim().slice(0,2);
    const dernier = i === brut.length - 1;
    const ouvert = dernier || x.max === null || x.max === undefined || x.max === "";
    const seuil = ouvert ? null : nombre(x.max, NaN);
    if (!l) { problemes.push("lettres : une entrée sans lettre a été ignorée"); return; }
    if (!ouvert && (!Number.isFinite(seuil) || seuil <= precedent)) { problemes.push("lettres : seuil de « "+l+" » hors d'ordre, entrée ignorée"); return; }
    out.push({ l, max: ouvert ? null : seuil, lab: String(x.lab || l), desc: String(x.desc || "") });
    if (!ouvert) precedent = seuil;
  });
  if (out.length < 2) { problemes.push("lettres : échelle inexploitable, échelle par défaut reprise"); return BAREME_DEFAUT.lettres.map(x=>({...x})); }
  out[out.length-1].max = null;              // la dernière lettre absorbe le reste
  return out;
}

/* Rend un barème utilisable à partir de n'importe quoi : la page publique ne
   doit jamais tomber en panne parce qu'un réglage est aberrant. */
export function normaliserBareme(brut) {
  const problemes = [];
  const b = (brut && typeof brut === "object") ? brut : {};
  const D = BAREME_DEFAUT;
  const choixAgreg = (v, permis, d) => permis.includes(v) ? v : d;
  const out = {
    version: nombre(b.version, 1),
    lettres: lettresValides(b.lettres, problemes),
    proprete: {
      libelle: String((b.proprete && b.proprete.libelle) || D.proprete.libelle),
      paliers: paliersValides(b.proprete && b.proprete.paliers, D.proprete.paliers, problemes, "propreté"),
      depotSansSac: positif(b.proprete && b.proprete.depotSansSac, D.proprete.depotSansSac),
    },
    remplissage: {
      libelle: String((b.remplissage && b.remplissage.libelle) || D.remplissage.libelle),
      inaccessible: positif(b.remplissage && b.remplissage.inaccessible, D.remplissage.inaccessible),
      paliers: paliersValides(b.remplissage && b.remplissage.paliers, D.remplissage.paliers, problemes, "remplissage"),
    },
    recidive: {
      libelle: String((b.recidive && b.recidive.libelle) || D.recidive.libelle),
      fenetreJours: Math.max(1, Math.round(positif(b.recidive && b.recidive.fenetreJours, D.recidive.fenetreJours))),
      paliers: paliersValides(b.recidive && b.recidive.paliers, D.recidive.paliers, problemes, "récidive"),
    },
    passage: { minutes: Math.max(0, positif(b.passage && b.passage.minutes, D.passage.minutes)) },
    agregation: {
      ilot: choixAgreg(b.agregation && b.agregation.ilot, ["max","moyenne"], D.agregation.ilot),
      commune: choixAgreg(b.agregation && b.agregation.commune, ["moyenne","max"], D.agregation.commune),
    },
  };
  out.problemes = problemes;
  return out;
}

/* Le barème actif. LETTRES est modifié sur place : les pages l'ont importé une
   fois et doivent voir le changement sans se recharger. */
let B = normaliserBareme(BAREME_DEFAUT);
export const LETTRES = [];
export let FENETRE_PASSAGE = 0;

export function appliquerBareme(brut) {
  B = normaliserBareme(brut === undefined ? BAREME_DEFAUT : brut);
  LETTRES.length = 0;
  B.lettres.forEach((x,i) => {
    const st = STYLE_LETTRE[x.l] || { var:"--s"+x.l, fill: STYLE_SECOURS[Math.min(i,4)] };
    LETTRES.push({ l:x.l, max: x.max === null ? Infinity : x.max, lab:x.lab, desc:x.desc, var:st.var, fill:st.fill });
  });
  FENETRE_PASSAGE = B.passage.minutes * 60000;
  return B;
}
export const bareme = () => B;

/* Le total maximum atteignable : sert d'échelle aux barres de la page. */
export const maxPoints = () =>
  [B.proprete, B.remplissage, B.recidive].reduce((a,c) =>
    a + Math.max(...c.paliers.map(p=>p.points), c === B.remplissage ? B.remplissage.inaccessible : 0), 0);

const pointsPalier = (paliers, valeur) => {
  for (const p of paliers) if (p.max === null || valeur <= p.max) return p.points;
  return paliers[paliers.length-1].points;
};
const indexPalier = (paliers, valeur) => {
  for (let i=0;i<paliers.length;i++) if (paliers[i].max === null || valeur <= paliers[i].max) return i;
  return paliers.length-1;
};

export const FLUX_LABEL={verre:"Verre",ordures_menageres:"Ordures ménagères",emballages:"Emballages",
  papier:"Papier",carton:"Carton",textile:"Textile",biodechets:"Biodéchets"};
export const CAUSE_LABEL={incivilite:"Incivilité",inadequation:"Inadéquation du dispositif",saturation:"Saturation"};
export const ORDRE_FLUX={verre:0,ordures_menageres:1,emballages:2,papier:3,carton:4,biodechets:5,textile:6};

/* ── Les trois critères, lus dans le barème actif ─────────────────────── */
export function lettre(pts){ return LETTRES.find(x=>pts<=x.max) || LETTRES[LETTRES.length-1]; }

export function ptsProprete(sacs,depot){
  if(!depot && sacs===0) return B.proprete.paliers[0].points;
  /* Dépôt constaté sans sac dénombrable : un carton, un encombrant. Zéro
     serait faux, et le compter comme un sac serait arbitraire. */
  if(sacs===0) return B.proprete.depotSansSac;
  return pointsPalier(B.proprete.paliers,sacs);
}
export function ptsRemplissage(o,ref){
  if(o.inaccessible) return B.remplissage.inaccessible;
  if(!ref.n||o.vues===0) return B.remplissage.paliers[0].points;
  return pointsPalier(B.remplissage.paliers,taux(o,ref));
}
export function ptsRecidive(n){ return pointsPalier(B.recidive.paliers,n); }

/* Arrondi au dix-millième : un seuil écrit 0,3333 dans bareme.json doit se
   comporter comme le tiers exact, sinon 1 conteneur plein sur 3 basculerait
   d'un palier à l'autre selon l'écriture du fichier. */
const taux=(o,ref)=>Math.round((o.bloquees+o.pleines)/ref.n*10000)/10000;

export function nPassagesAvecDepot(site,flux,tFin,obs){
  const fenetre=B.recidive.fenetreJours*86400000;
  const liste=obs.filter(x=>x.site===site&&x.flux===flux&&x.depotSol
    &&new Date(x.ts).getTime()<=tFin
    &&new Date(x.ts).getTime()>=tFin-fenetre)
    .sort((a,b)=>new Date(a.ts)-new Date(b.ts));
  let n=0,prec=-Infinity;
  liste.forEach(x=>{const t=new Date(x.ts).getTime(); if(t-prec>FENETRE_PASSAGE) n++; prec=t;});
  return n;
}

/* ── Le barème se raconte lui-même ─────────────────────────────────────────
   La page d'explication était écrite à la main, avec ses seuils recopiés : au
   premier réglage elle aurait menti. Elle est désormais fabriquée d'ici. */
const pct = v => Math.round(v*100)+" %";
function libellesPaliers(paliers, unite, rien){
  return paliers.map((p,i)=>{
    const bas = i===0 ? 0 : paliers[i-1].max+1;
    if(p.max===0) return rien;
    if(p.max===null) return bas+" "+unite+(bas>1?"s":"")+" ou plus";
    if(bas===p.max) return bas+" "+unite;
    return bas+" à "+p.max+" "+unite+"s";
  });
}
function libellesTaux(paliers){
  return paliers.map((p,i)=>{
    if(p.max===0) return "aucun plein";
    if(p.max===null) return "plus de "+pct(paliers[i-1] ? paliers[i-1].max : 0);
    return "jusqu'à "+pct(p.max);
  });
}
export function decrireBareme(){
  const txtPr = libellesPaliers(B.proprete.paliers,"sac","rien au sol");
  const txtRc = libellesPaliers(B.recidive.paliers,"passage","aucun passage");
  const txtRe = libellesTaux(B.remplissage.paliers);
  const itemsRe = B.remplissage.paliers.map((p,i)=>({texte:txtRe[i],points:p.points}));
  /* L'accès bloqué vaut un forfait : on le colle au palier de même poids
     plutôt que d'inventer une colonne de plus. */
  const memePoids = itemsRe.find(it=>it.points===B.remplissage.inaccessible);
  if(memePoids) memePoids.texte += " ou accès bloqué";
  else itemsRe.push({texte:"accès bloqué",points:B.remplissage.inaccessible});

  const critere=(cle,conf,items)=>({cle,libelle:conf.libelle,items,
    max:Math.max(...items.map(i=>i.points))});
  const criteres=[
    critere("pr",B.proprete,B.proprete.paliers.map((p,i)=>({texte:txtPr[i],points:p.points}))),
    critere("re",B.remplissage,itemsRe),
    critere("rc",{libelle:B.recidive.libelle+" sur "+B.recidive.fenetreJours+" jours"},
            B.recidive.paliers.map((p,i)=>({texte:txtRc[i],points:p.points}))),
  ];
  const max=criteres.reduce((a,c)=>a+c.max,0);
  const echelle=LETTRES.map((x,i)=>({
    l:x.l, lab:x.lab, desc:x.desc, var:x.var,
    bas: i===0 ? 0 : (LETTRES[i-1].max+1),
    haut: Number.isFinite(x.max) ? x.max : null,
  }));
  const derniere=echelle[echelle.length-1];
  return {
    criteres, max, echelle,
    seuilDerniereLettre: derniere.bas,
    derniereLettre: derniere.l,
    premiereLettre: echelle[0].l,
    fenetreJours: B.recidive.fenetreJours,
    passageMinutes: B.passage.minutes,
    agregation: {...B.agregation},
    problemes: B.problemes || [],
  };
}

/* ── Mise en forme des dates (partagée, pour que les deux pages parlent
   la même langue) ───────────────────────────────────────────────────────── */
export function dateFR(iso){const d=new Date(iso);return d.toLocaleDateString('fr-FR',{day:'numeric',month:'long'})+' à '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}
export function jours(iso){return Math.floor((Date.now()-new Date(iso).getTime())/86400000)}

/* ── Données brutes → objets de travail ───────────────────────────────────
   donnees.json est publié depuis le classeur ; on n'y touche pas, on le
   normalise ici (drapeau « test » déduit de l'identifiant de la photo). */
export function normaliser(donnees){
  const REF=(donnees.referentiel||[]).map(r=>({
    site:String(r.site), nom:String(r.nom),
    lat:Number(r.lat), lon:Number(r.lon),
    flux:String(r.flux), nbUnites:Number(r.nbUnites)||0
  }));
  const OBS=(donnees.observations||[]).map(o=>({
    uuid:String(o.uuid), ts:o.ts, site:String(o.site), flux:String(o.flux),
    photo:o.photo||"", inaccessible:!!o.inaccessible,
    vues:Number(o.vues)||0, dessus:Number(o.dessus)||0,
    bloquees:Number(o.bloquees)||0, pleines:Number(o.pleines)||0,
    depotSol:!!o.depotSol, sacs:Number(o.sacs)||0,
    cause:o.cause||"", confiance:Number(o.confiance)||0, texte:o.texte||"",
    /* Deux drapeaux posés par le classifieur. Ils ne changent rien à la note :
       ils interdisent seulement de publier la photo. Absents du fichier (ancienne
       version des données), ils valent faux. */
    personneVisible:!!o.personneVisible, plaqueLisible:!!o.plaqueLisible,
    test:/^(test|cors)-/.test(String(o.uuid))
  }));
  return {REF,OBS,commune:donnees.commune||"",departement:donnees.departement||"",maj:donnees.maj||null};
}

/* ── Lecture d'un couple îlot × flux ──────────────────────────────────────
   Sans nb_unites au référentiel, on se rabat sur le maximum déjà observé :
   c'est provisoire, sous-estimé, et la page doit le dire. */
export function unitesRef(REF,site,flux,obs){
  const r=REF.find(x=>x.site===site&&x.flux===flux);
  if(r&&r.nbUnites>0) return {n:r.nbUnites,provisoire:false};
  const maxVu=Math.max(0,...obs.filter(o=>o.site===site&&o.flux===flux).map(o=>o.vues));
  return {n:maxVu,provisoire:true};
}
/* Les niveaux 0-3 servent la météo (l'icône), pas la note. On les déduit du
   rang du palier atteint : un barème à plus de quatre paliers reste lisible,
   on plafonne simplement à l'icône la plus sombre. */
const rangDepuisPoints=(paliers,pts)=>{
  const i=paliers.findIndex(p=>p.points>=pts);
  return Math.min(3, i<0?paliers.length-1:i);
};
export function niveauProprete(o){
  return rangDepuisPoints(B.proprete.paliers, ptsProprete(o.sacs,o.depotSol));
}
export function niveauRemplissage(o,ref){
  if(o.inaccessible) return {n:rangDepuisPoints(B.remplissage.paliers,B.remplissage.inaccessible),txt:"accès bloqué"};
  if(o.vues===0) return {n:null,txt:"aucune unité visible"};
  if(!ref.n) return {n:null,txt:"nombre de conteneurs inconnu"};
  const occupe=o.bloquees+o.pleines;
  const n = Math.min(3, indexPalier(B.remplissage.paliers, taux(o,ref)));
  return {n,txt:occupe+" sur "+ref.n+" conteneur"+(ref.n>1?"s":"")+" plein ou bloqué"+(occupe>1?"s":"")+(ref.provisoire?" (effectif provisoire)":"")};
}

/* ── État courant de chaque îlot ──────────────────────────────────────────
   Le dernier relevé de chaque flux ; l'îlot retient le flux le plus dégradé. */
export function calcule(REF,obs){
  const parSite={};
  REF.forEach(r=>{
    if(!parSite[r.site]) parSite[r.site]={site:r.site,nom:r.nom,lat:r.lat,lon:r.lon,flux:[],dernier:null,niveau:null};
  });
  const couples=new Set();
  REF.forEach(r=>couples.add(r.site+"|"+r.flux));
  obs.forEach(o=>couples.add(o.site+"|"+o.flux));
  [...couples].forEach(k=>{
    const [site,flux]=k.split("|");
    if(!parSite[site]) return;
    const liste=obs.filter(o=>o.site===site&&o.flux===flux).sort((a,b)=>new Date(b.ts)-new Date(a.ts));
    const o=liste[0];
    const horsRef=!REF.some(r=>r.site===site&&r.flux===flux);
    if(!o){parSite[site].flux.push({flux,niveau:null,horsRef,detail:"aucun relevé"});return}
    const ref=unitesRef(REF,site,flux,obs);
    if(o.vues===0 && !o.inaccessible){
      parSite[site].flux.push({flux,niveau:null,nonVisible:true,horsRef,detail:"conteneur non repéré sur la photo du "+dateFR(o.ts),ts:o.ts,test:o.test,
        photo:o.photo||"", publiable:!!o.photo && !o.personneVisible && !o.plaqueLisible, texte:o.texte||""});
      if(!parSite[site].dernier||new Date(o.ts)>new Date(parSite[site].dernier)) parSite[site].dernier=o.ts;
      return;
    }
    const p=niveauProprete(o), rm=niveauRemplissage(o,ref);
    const niveau=Math.max(p, rm.n==null?0:rm.n);
    const nRecid=nPassagesAvecDepot(site,flux,new Date(o.ts).getTime(),obs);
    const sc={pr:ptsProprete(o.sacs,o.depotSol),re:ptsRemplissage(o,ref),rc:ptsRecidive(nRecid),nRecid};
    sc.total=sc.pr+sc.re+sc.rc; sc.L=lettre(sc.total);
    const bouts=[];
    bouts.push(o.sacs>0?o.sacs+" sac"+(o.sacs>1?"s":"")+" au sol":"rien au sol");
    bouts.push(rm.txt);
    if(o.cause) bouts.push((CAUSE_LABEL[o.cause]||o.cause).toLowerCase());
    if(nRecid>1) bouts.push(nRecid+" passages avec dépôt sur "+B.recidive.fenetreJours+" j");
    parSite[site].flux.push({flux,niveau,horsRef,sc,detail:bouts.join(" · "),ts:o.ts,test:o.test,
      photo:o.photo||"", publiable:!!o.photo && !o.personneVisible && !o.plaqueLisible, texte:o.texte||""});
    if(!parSite[site].dernier||new Date(o.ts)>new Date(parSite[site].dernier)) parSite[site].dernier=o.ts;
  });
  /* Du flux à l'îlot : par défaut l'îlot retient son flux le plus dégradé —
     un point dont le verre déborde n'est pas « à moitié propre ». Une commune
     peut préférer la moyenne ; c'est un réglage, pas une vérité. */
  const pire=l=>B.agregation.ilot==="moyenne"
    ? Math.round(l.reduce((a,b)=>a+b,0)/l.length) : Math.max(...l);
  Object.values(parSite).forEach(s=>{
    const n=s.flux.filter(f=>f.niveau!==null).map(f=>f.niveau);
    s.niveau=n.length?pire(n):null;
    const scs=s.flux.filter(f=>f.sc).map(f=>f.sc.total);
    s.pts=scs.length?pire(scs):null;
    s.L=s.pts===null?null:lettre(s.pts);
    s.flux.sort((a,b)=>(ORDRE_FLUX[a.flux]??9)-(ORDRE_FLUX[b.flux]??9));
  });
  return Object.values(parSite).sort((a,b)=>a.site.localeCompare(b.site));
}

/* ── Historique : un carré par passage ────────────────────────────────────
   Un « passage » regroupe les photos prises au même endroit à quelques
   minutes d'intervalle. Sa note est celle du flux le plus dégradé, calculée
   avec les données connues à cette date-là : la récidive ne compte que le
   passé, de sorte qu'un carré déjà affiché ne change plus. */
export function passagesParSite(REF,obs){
  const sites={};
  REF.forEach(r=>{if(!sites[r.site]) sites[r.site]={site:r.site,nom:r.nom,lots:[]}});
  const parSite={};
  obs.forEach(o=>{(parSite[o.site]=parSite[o.site]||[]).push(o)});
  Object.keys(sites).forEach(code=>{
    const liste=(parSite[code]||[]).slice().sort((a,b)=>new Date(a.ts)-new Date(b.ts));
    const lots=[];
    liste.forEach(o=>{
      const d=lots[lots.length-1];
      if(d && new Date(o.ts)-new Date(d.fin)<=FENETRE_PASSAGE){d.obs.push(o); d.fin=o.ts;}
      else lots.push({obs:[o],fin:o.ts});
    });
    lots.forEach(lot=>{
      const parFlux={};
      lot.obs.forEach(o=>{const p=parFlux[o.flux]; if(!p||new Date(o.ts)>new Date(p.ts)) parFlux[o.flux]=o});
      let pts=null,pire=null,depot=false;
      Object.values(parFlux).forEach(o=>{
        if(o.depotSol) depot=true;
        if(o.vues===0 && !o.inaccessible) return;
        const ref=unitesRef(REF,o.site,o.flux,obs);
        const nRecid=nPassagesAvecDepot(o.site,o.flux,new Date(o.ts).getTime(),obs);
        const total=ptsProprete(o.sacs,o.depotSol)+ptsRemplissage(o,ref)+ptsRecidive(nRecid);
        if(pts===null||total>pts){pts=total; pire=o;}
      });
      lot.pts=pts; lot.L=pts===null?null:lettre(pts); lot.depot=depot;
      lot.photo=(pire||lot.obs[0]).photo;
    });
    sites[code].lots=lots;
  });
  return Object.values(sites).sort((a,b)=>a.site.localeCompare(b.site));
}

/* ── Résumé pour la vignette ──────────────────────────────────────────────
   Les relevés de test sont écartés : la vignette est pour les habitants.
   La note de la commune est la moyenne des points des îlots notés ; elle est
   convertie en lettre sur le total arrondi, et le dénominateur (combien de
   points ont été relevés) voyage avec, pour que personne ne prenne une
   moyenne sur 4 points pour une moyenne sur 6. */
export function resume(REF,OBS,meta={}){
  const obs=OBS.filter(o=>!o.test);
  const sites=calcule(REF,obs);
  const notes=sites.filter(s=>s.pts!==null);
  const vals=notes.map(s=>s.pts);
  const moy=!vals.length?null
    : B.agregation.commune==="max" ? Math.max(...vals)
    : vals.reduce((a,b)=>a+b,0)/vals.length;
  const L=moy===null?null:lettre(Math.round(moy));
  return {
    commune:meta.commune||"",
    maj:meta.maj||new Date().toISOString(),
    global:L?{lettre:L.l,lab:L.lab,pts:Math.round(moy*10)/10,notes:notes.length}:null,
    total:sites.length,
    points:sites.map(s=>({code:s.site,nom:s.nom,lettre:s.L?s.L.l:null,lab:s.L?s.L.lab:null,pts:s.pts,dernier:s.dernier})),
    echelle:LETTRES.map(x=>({l:x.l,lab:x.lab,max:Number.isFinite(x.max)?x.max:null}))
  };
}

/* Barème par défaut actif dès l'import : une page qui ne charge pas
   bareme.json calcule quand même, avec les valeurs d'origine. */
appliquerBareme();
