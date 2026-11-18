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

/* ── Barème ────────────────────────────────────────────────────────────────
   Note A→E d'un point de collecte, sur le modèle du Nutri-Score.
   Points de pénalité : propreté au sol (0-6) + remplissage (0-4)
   + récidive sur 30 jours (0-4). */
export const LETTRES = [
 {l:"A",max:1,var:"--sA",fill:.12,lab:"Impeccable",desc:"rien au sol, conteneurs disponibles"},
 {l:"B",max:3,var:"--sB",fill:.32,lab:"Bon",desc:"incident isolé ou léger"},
 {l:"C",max:6,var:"--sC",fill:.56,lab:"Moyen",desc:"dépôts qui reviennent ou saturation partielle"},
 {l:"D",max:9,var:"--sD",fill:.8,lab:"Dégradé",desc:"dépôts réguliers ou conteneurs souvent pleins"},
 {l:"E",max:99,var:"--sE",fill:1,lab:"Point noir",desc:"dépôts massifs ou récidive chaque semaine"}
];
export const FLUX_LABEL={verre:"Verre",ordures_menageres:"Ordures ménagères",emballages:"Emballages",papier:"Papier"};
export const CAUSE_LABEL={incivilite:"Incivilité",inadequation:"Inadéquation du dispositif",saturation:"Saturation"};
export const ORDRE_FLUX={verre:0,ordures_menageres:1,emballages:2,papier:3};

export function lettre(pts){return LETTRES.find(x=>pts<=x.max)}
export function ptsProprete(sacs,depot){if(!depot&&sacs===0)return 0;if(sacs<=2)return 2;if(sacs<=4)return 4;return 6}
export function ptsRemplissage(o,ref){
  if(o.inaccessible) return 4;
  if(!ref.n||o.vues===0) return 0;
  const t=(o.bloquees+o.pleines)/ref.n;
  return t===0?0:t<=1/3?1:t<=2/3?2:4;
}
export function ptsRecidive(n){return n===0?0:n===1?1:n<=3?2:4}

/* Deux photos du même tas prises à quelques minutes d'intervalle sont UN
   constat, pas deux : sinon le score récompenserait la parcimonie en photos. */
export const FENETRE_PASSAGE=20*60000;
export function nPassagesAvecDepot(site,flux,tFin,obs){
  const liste=obs.filter(x=>x.site===site&&x.flux===flux&&x.depotSol
    &&new Date(x.ts).getTime()<=tFin
    &&new Date(x.ts).getTime()>=tFin-30*86400000)
    .sort((a,b)=>new Date(a.ts)-new Date(b.ts));
  let n=0,prec=-Infinity;
  liste.forEach(x=>{const t=new Date(x.ts).getTime(); if(t-prec>FENETRE_PASSAGE) n++; prec=t;});
  return n;
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
export function niveauProprete(o){
  if(!o.depotSol && o.sacs===0) return 0;
  if(o.sacs<=2) return 1;
  if(o.sacs<=4) return 2;
  return 3;
}
export function niveauRemplissage(o,ref){
  if(o.inaccessible) return {n:3,txt:"accès bloqué"};
  if(o.vues===0) return {n:null,txt:"aucune unité visible"};
  if(!ref.n) return {n:null,txt:"nombre de conteneurs inconnu"};
  const occupe=o.bloquees+o.pleines;
  const taux=occupe/ref.n;
  const n = taux===0?0 : taux<=1/3?1 : taux<=2/3?2 : 3;
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
    if(nRecid>1) bouts.push(nRecid+" passages avec dépôt sur 30 j");
    parSite[site].flux.push({flux,niveau,horsRef,sc,detail:bouts.join(" · "),ts:o.ts,test:o.test,
      photo:o.photo||"", publiable:!!o.photo && !o.personneVisible && !o.plaqueLisible, texte:o.texte||""});
    if(!parSite[site].dernier||new Date(o.ts)>new Date(parSite[site].dernier)) parSite[site].dernier=o.ts;
  });
  Object.values(parSite).forEach(s=>{
    const n=s.flux.filter(f=>f.niveau!==null).map(f=>f.niveau);
    s.niveau=n.length?Math.max(...n):null;
    const scs=s.flux.filter(f=>f.sc).map(f=>f.sc.total);
    s.pts=scs.length?Math.max(...scs):null;
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
  const moy=notes.length?notes.reduce((a,s)=>a+s.pts,0)/notes.length:null;
  const L=moy===null?null:lettre(Math.round(moy));
  return {
    commune:meta.commune||"",
    maj:meta.maj||new Date().toISOString(),
    global:L?{lettre:L.l,lab:L.lab,pts:Math.round(moy*10)/10,notes:notes.length}:null,
    total:sites.length,
    points:sites.map(s=>({code:s.site,nom:s.nom,lettre:s.L?s.L.l:null,lab:s.L?s.L.lab:null,pts:s.pts,dernier:s.dernier})),
    echelle:LETTRES.map(x=>({l:x.l,lab:x.lab,max:x.max}))
  };
}
