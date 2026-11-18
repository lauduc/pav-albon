/* Encodeur QR minimal — mode octet, correction M, versions 1 à 10.
 *
 * Pourquoi ce fichier existe : le QR de partage encode l'adresse publique de
 * la commune. Figé dans la page, il aurait fallu le regénérer à la main à
 * chaque déploiement, et il aurait menti le jour où l'adresse change. Ici il
 * se fabrique au chargement, à partir de config.json.
 *
 * Portée volontairement courte : une URL tient largement dans la version 10
 * (213 octets). Au-delà, encoder() renvoie null et l'appelant masque le QR
 * plutôt que d'afficher un code faux.
 */

/* ── Tables normalisées (ISO/IEC 18004), niveau de correction M ─────────── */
/* [octets de correction par bloc, [[nombre de blocs, octets de données], …]] */
const EC_M = {
  1:[10,[[1,16]]],  2:[16,[[1,28]]],  3:[26,[[1,44]]],  4:[18,[[2,32]]],
  5:[24,[[2,43]]],  6:[16,[[4,27]]],  7:[18,[[4,31]]],
  8:[22,[[2,38],[2,39]]], 9:[22,[[3,36],[2,37]]], 10:[26,[[4,43],[1,44]]],
};
const ALIGN = {
  1:[], 2:[6,18], 3:[6,22], 4:[6,26], 5:[6,30],
  6:[6,34], 7:[6,22,38], 8:[6,24,42], 9:[6,26,46], 10:[6,28,50],
};
const VERSION_BITS = { 7:0x07C94, 8:0x085BC, 9:0x09A99, 10:0x0A4D3 };
const FORMAT_M = [0x5412,0x5125,0x5E7C,0x5B4B,0x45F9,0x40CE,0x4F97,0x4AA0];

/* ── Corps de Galois GF(256), polynôme 0x11D ────────────────────────────── */
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
for (let i = 0, x = 1; i < 255; i++) {
  EXP[i] = x; LOG[x] = i;
  x <<= 1; if (x & 0x100) x ^= 0x11D;
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
const mul = (a, b) => (a && b) ? EXP[LOG[a] + LOG[b]] : 0;

/* Polynôme générateur de degré n. */
function generateur(n) {
  let g = [1];
  for (let i = 0; i < n; i++) {
    const s = [...g, 0];
    for (let j = 0; j < g.length; j++) s[j + 1] ^= mul(g[j], EXP[i]);
    g = s;
  }
  return g;
}

/* Reste de la division du bloc par le générateur : les octets de correction. */
function correction(bloc, n) {
  const g = generateur(n), r = new Uint8Array(bloc.length + n);
  r.set(bloc);
  for (let i = 0; i < bloc.length; i++) {
    const c = r[i];
    if (!c) continue;
    for (let j = 0; j < g.length; j++) r[i + j] ^= mul(g[j], c);
  }
  return r.slice(bloc.length);
}

/* ── Flux binaire ───────────────────────────────────────────────────────── */
function bits(octets, version) {
  const total = EC_M[version][1].reduce((a, [n, d]) => a + n * d, 0);
  const tailleLongueur = version >= 10 ? 16 : 8;
  const b = [];
  const pousser = (v, n) => { for (let i = n - 1; i >= 0; i--) b.push((v >> i) & 1); };
  pousser(0b0100, 4);                 // mode octet
  pousser(octets.length, tailleLongueur);
  for (const o of octets) pousser(o, 8);
  if (b.length > total * 8) return null;
  for (let i = 0; i < 4 && b.length < total * 8; i++) b.push(0);  // terminateur
  while (b.length % 8) b.push(0);
  const mots = [];
  for (let i = 0; i < b.length; i += 8) {
    let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | b[i + j];
    mots.push(v);
  }
  for (let i = 0; mots.length < total; i++) mots.push(i % 2 ? 0x11 : 0xEC);
  return mots;
}

/* Les blocs sont entrelacés : un octet de chaque bloc à tour de rôle. */
function entrelacer(mots, version) {
  const [nEC, groupes] = EC_M[version];
  const blocs = [], ecs = [];
  let p = 0;
  for (const [nb, taille] of groupes) {
    for (let i = 0; i < nb; i++) {
      const bloc = mots.slice(p, p + taille); p += taille;
      blocs.push(bloc); ecs.push(correction(bloc, nEC));
    }
  }
  const out = [];
  const maxD = Math.max(...blocs.map(b => b.length));
  for (let i = 0; i < maxD; i++) for (const b of blocs) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < nEC; i++) for (const e of ecs) out.push(e[i]);
  return out;
}

/* ── Trame ──────────────────────────────────────────────────────────────── */
function trame(version) {
  const n = version * 4 + 17;
  const m = Array.from({ length: n }, () => new Int8Array(n).fill(-1));  // -1 = libre
  const pose = (x, y, v) => { if (x >= 0 && y >= 0 && x < n && y < n) m[y][x] = v; };

  // Trois repères de position, avec leur séparateur blanc.
  for (const [cx, cy] of [[0,0],[n-7,0],[0,n-7]]) {
    for (let dy = -1; dy <= 7; dy++) for (let dx = -1; dx <= 7; dx++) {
      const bord = dx === 0 || dx === 6 || dy === 0 || dy === 6;
      const coeur = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      const dedans = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      pose(cx + dx, cy + dy, dedans && (bord || coeur) ? 1 : 0);
    }
  }
  // Repères d'alignement, sauf là où ils chevaucheraient un repère de position.
  const a = ALIGN[version];
  for (const cy of a) for (const cx of a) {
    if ((cx < 8 && cy < 8) || (cx < 8 && cy > n - 9) || (cx > n - 9 && cy < 8)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++)
      pose(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1 ? 1 : 0);
  }
  // Lignes de synchronisation.
  for (let i = 8; i < n - 8; i++) { pose(i, 6, i % 2 ? 0 : 1); pose(6, i, i % 2 ? 0 : 1); }
  pose(8, n - 8, 1);                                   // module toujours noir
  // Emplacements réservés au format (remplis après le masquage).
  for (let i = 0; i < 9; i++) { if (m[8][i] === -1) pose(i, 8, 0); if (m[i][8] === -1) pose(8, i, 0); }
  for (let i = 0; i < 8; i++) { pose(n - 1 - i, 8, 0); pose(8, n - 1 - i, 0); }
  // Information de version, à partir de la version 7.
  if (version >= 7) {
    const v = VERSION_BITS[version];
    for (let i = 0; i < 18; i++) {
      const b = (v >> i) & 1, r = Math.floor(i / 3), c = i % 3;
      pose(r, n - 11 + c, b); pose(n - 11 + c, r, b);
    }
  }
  return m;
}

/* Parcours en zigzag, de droite à gauche, en sautant la colonne de synchro. */
function remplir(m, mots) {
  const n = m.length, flux = [];
  for (const o of mots) for (let i = 7; i >= 0; i--) flux.push((o >> i) & 1);
  let k = 0, montant = true;
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (let i = 0; i < n; i++) {
      const y = montant ? n - 1 - i : i;
      for (const x of [col, col - 1]) {
        if (m[y][x] !== -1) continue;
        m[y][x] = k < flux.length ? flux[k++] : 0;
      }
    }
    montant = !montant;
  }
}

const MASQUES = [
  (y,x) => (y + x) % 2 === 0,
  (y)   => y % 2 === 0,
  (y,x) => x % 3 === 0,
  (y,x) => (y + x) % 3 === 0,
  (y,x) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (y,x) => (y * x) % 2 + (y * x) % 3 === 0,
  (y,x) => ((y * x) % 2 + (y * x) % 3) % 2 === 0,
  (y,x) => ((y + x) % 2 + (y * x) % 3) % 2 === 0,
];

/* Pénalités normalisées : on garde le masque qui rend le code le plus lisible. */
function penalite(g) {
  const n = g.length; let p = 0;
  const serie = ligne => {
    let c = 1;
    for (let i = 1; i < n; i++) {
      if (ligne[i] === ligne[i - 1]) { c++; if (c === 5) p += 3; else if (c > 5) p++; }
      else c = 1;
    }
  };
  for (let y = 0; y < n; y++) serie(g[y]);
  for (let x = 0; x < n; x++) serie(g.map(r => r[x]));
  for (let y = 0; y < n - 1; y++) for (let x = 0; x < n - 1; x++)
    if (g[y][x] === g[y][x+1] && g[y][x] === g[y+1][x] && g[y][x] === g[y+1][x+1]) p += 3;
  const motif = [1,0,1,1,1,0,1,0,0,0,0];
  const cherche = l => {
    for (let i = 0; i + 11 <= n; i++) {
      let ok1 = true, ok2 = true;
      for (let j = 0; j < 11; j++) {
        if (l[i + j] !== motif[j]) ok1 = false;
        if (l[i + j] !== motif[10 - j]) ok2 = false;
      }
      if (ok1 || ok2) p += 40;
    }
  };
  for (let y = 0; y < n; y++) cherche(g[y]);
  for (let x = 0; x < n; x++) cherche(g.map(r => r[x]));
  let noirs = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) noirs += g[y][x];
  p += Math.floor(Math.abs(noirs * 100 / (n * n) - 50) / 5) * 10;
  return p;
}

/* Renvoie une matrice de 0/1, ou null si le texte ne tient pas. */
export function encoder(texte) {
  const octets = [...new TextEncoder().encode(String(texte))];
  let version = 0, mots = null;
  for (let v = 1; v <= 10; v++) { const b = bits(octets, v); if (b) { version = v; mots = b; break; } }
  if (!version) return null;

  const reserve = trame(version);                     // sert de masque des zones fixes
  const base = trame(version);
  remplir(base, entrelacer(mots, version));

  let meilleur = null, meilleurScore = Infinity, meilleurMasque = 0;
  for (let k = 0; k < 8; k++) {
    const g = base.map((r, y) => Array.from(r, (v, x) =>
      reserve[y][x] === -1 && MASQUES[k](y, x) ? v ^ 1 : v));
    const s = penalite(g);
    if (s < meilleurScore) { meilleurScore = s; meilleur = g; meilleurMasque = k; }
  }

  // Information de format, écrite en double exemplaire.
  const n = meilleur.length, f = FORMAT_M[meilleurMasque];
  for (let i = 0; i < 15; i++) {
    const b = (f >> (14 - i)) & 1;   // bit de poids fort en premier
    if (i < 6)       { meilleur[8][i] = b;         meilleur[n-1-i][8] = b; }
    else if (i === 6){ meilleur[8][7] = b;         meilleur[n-7][8]   = b; }
    else if (i === 7){ meilleur[8][8] = b;         meilleur[8][n-8]   = b; }
    else if (i === 8){ meilleur[7][8] = b;         meilleur[8][n-7]   = b; }
    else             { meilleur[14-i][8] = b;      meilleur[8][n-15+i] = b; }
  }
  meilleur[n-8][8] = 1;
  return meilleur;
}

/* Un seul tracé SVG : chaque suite de modules noirs devient un rectangle. */
export function tracé(matrice) {
  const n = matrice.length, d = [];
  for (let y = 0; y < n; y++) {
    let x = 0;
    while (x < n) {
      if (!matrice[y][x]) { x++; continue; }
      let l = 0;
      while (x + l < n && matrice[y][x + l]) l++;
      d.push(`M${x} ${y}h${l}v1h-${l}z`);
      x += l;
    }
  }
  return d.join('');
}

/* Remplit un <svg> existant : viewBox à la taille du code, un chemin noir. */
export function dessiner(svg, texte) {
  const m = encoder(texte);
  if (!m) return false;
  const n = m.length;
  svg.setAttribute('viewBox', `-2 -2 ${n + 4} ${n + 4}`);   // marge blanche normalisée
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.innerHTML = `<path fill="#fff" d="M-2 -2h${n + 4}v${n + 4}h-${n + 4}z"/>`
                + `<path fill="#000" d="${tracé(m)}"/>`;
  return true;
}
