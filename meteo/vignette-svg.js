/* Vignette SVG — le dessin de l'encart, et rien que le dessin.
 *
 * Ce module ne calcule aucune note : il reçoit le résumé produit par
 * bac-score.js et le met en image. Il est publié ici pour que le workflow de
 * publication puisse le charger et regénérer l'image à chaque changement de
 * données — personne ne refait de capture d'écran à la main.
 *
 * Format fixe 560 x 420, thème clair : l'image est faite pour être posée dans
 * le site d'une mairie, sur un CMS qu'on ne maîtrise pas, et une image qui
 * change de taille casse une mise en page.
 */
export function vignetteSVG(r) {
  const L = { A: '#1b7a3e', B: '#74a524', C: '#d7a208', D: '#d96a18', E: '#bd2a1d' };
  const OFF = '#b9c2bf', INK = '#1A1F1C', MUTED = '#6A716B', LINE = '#D8DCD7', SOFT = '#F1F3F0';
  const UI = "Barlow, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
  const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  // Pas d'ellipse automatique en SVG : on coupe au nombre de caractères qui tient.
  const court = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  const dateFR = iso => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

  const g = r.global;
  const releves = r.points.filter(p => p.lettre);
  const dernier = releves.map(p => p.dernier).sort().pop();
  const couv = releves.length + ' des ' + r.total + ' points relevé' + (releves.length > 1 ? 's' : '');
  const sous = couv + (dernier ? ' · dernier le ' + dateFR(dernier) : '');

  const ordonne = r.points.slice().sort((a, b) =>
    (b.pts == null ? -1 : b.pts) - (a.pts == null ? -1 : a.pts) || a.code.localeCompare(b.code));
  const MAX = 6;
  const tiennent = r.points.length > MAX ? MAX - 1 : MAX;
  const liste = ordonne.slice(0, tiennent);
  const reste = ordonne.length - liste.length;

  const out = [];
  out.push('<svg xmlns="http://www.w3.org/2000/svg" width="560" height="420" viewBox="0 0 560 420" role="img"' +
    ' aria-label="Propreté des points de collecte — ' + esc(r.commune) + ' : Bac-Score ' + (g ? g.lettre : 'non attribué') + '">');
  out.push('<rect width="560" height="420" fill="#FFFFFF"/>');

  // En-tête : la note, puis ce qu'elle veut dire
  out.push('<rect x="15" y="14" width="58" height="58" rx="13" fill="' + (g ? L[g.lettre] : OFF) + '"/>');
  out.push('<text x="44" y="56" text-anchor="middle" font-family="' + UI + '" font-size="34" font-weight="600" fill="#fff">' +
    (g ? g.lettre : '?') + '</text>');
  out.push('<text x="85" y="29" font-family="' + UI + '" font-size="12" font-weight="600" letter-spacing="1" fill="' + MUTED + '">' +
    esc(('Points de collecte — ' + r.commune).toUpperCase()) + '</text>');
  out.push('<text x="85" y="51" font-family="' + UI + '" font-size="18" font-weight="600" fill="' + INK + '">' +
    esc(g ? g.lab : 'Pas encore noté') + '</text>');
  out.push('<text x="85" y="70" font-family="' + UI + '" font-size="13" fill="' + MUTED + '">' + esc(sous) + '</text>');

  // Échelle A→E
  const lg = (560 - 30 - 4 * 3) / 5;
  r.echelle.forEach((x, i) => {
    const px = 15 + i * (lg + 3), on = g && x.l === g.lettre;
    out.push('<rect x="' + px.toFixed(1) + '" y="86" width="' + lg.toFixed(1) + '" height="26" rx="4" fill="' + L[x.l] + '"' +
      (on ? '' : ' opacity="0.34"') + '/>');
    if (on) out.push('<rect x="' + (px - 1.5).toFixed(1) + '" y="84.5" width="' + (lg + 3).toFixed(1) +
      '" height="29" rx="5.5" fill="none" stroke="' + INK + '" stroke-width="2"/>');
    out.push('<text x="' + (px + lg / 2).toFixed(1) + '" y="104" text-anchor="middle" font-family="' + UI +
      '" font-size="13" font-weight="600" fill="#fff">' + x.l + '</text>');
  });

  // Liste des points : hauteur de ligne fixe, la vignette ne doit jamais bouger
  let y = 124;
  liste.forEach((p, i) => {
    if (i) out.push('<line x1="15" y1="' + y + '" x2="545" y2="' + y + '" stroke="' + LINE + '" stroke-width="1"/>');
    out.push('<rect x="15" y="' + (y + 5) + '" width="21" height="21" rx="6" fill="' + (p.lettre ? L[p.lettre] : OFF) + '"/>');
    out.push('<text x="25.5" y="' + (y + 20) + '" text-anchor="middle" font-family="' + UI +
      '" font-size="12" font-weight="600" fill="#fff">' + (p.lettre || '–') + '</text>');
    out.push('<text x="45" y="' + (y + 20) + '" font-family="' + UI + '" font-size="13.5" fill="' +
      (p.lettre ? INK : MUTED) + '">' + esc(court(p.nom, 34)) + '</text>');
    out.push('<text x="545" y="' + (y + 20) + '" text-anchor="end" font-family="' + MONO + '" font-size="11" fill="' + MUTED + '">' +
      esc(p.lettre ? p.lab : 'sans relevé') + '</text>');
    y += 30;
  });
  if (reste > 0) {
    out.push('<line x1="15" y1="' + y + '" x2="545" y2="' + y + '" stroke="' + LINE + '" stroke-width="1"/>');
    out.push('<rect x="15" y="' + (y + 5) + '" width="21" height="21" rx="6" fill="' + OFF + '"/>');
    out.push('<text x="25.5" y="' + (y + 20) + '" text-anchor="middle" font-family="' + UI +
      '" font-size="12" font-weight="600" fill="#fff">+</text>');
    out.push('<text x="45" y="' + (y + 20) + '" font-family="' + UI + '" font-size="13.5" fill="' + MUTED + '">' +
      reste + ' autre' + (reste > 1 ? 's' : '') + ' point' + (reste > 1 ? 's' : '') + '</text>');
  }

  // Pied
  out.push('<line x1="15" y1="372" x2="545" y2="372" stroke="' + LINE + '" stroke-width="1"/>');
  out.push('<text x="15" y="396" font-family="' + UI + '" font-size="11.5" fill="' + MUTED + '">Bac-Score · relevés citoyens</text>');
  out.push('<rect x="421" y="378" width="124" height="30" rx="15" fill="' + SOFT + '" stroke="' + LINE + '"/>');
  out.push('<text x="483" y="398" text-anchor="middle" font-family="' + UI + '" font-size="13" font-weight="600" fill="' + INK + '">Voir le détail</text>');
  out.push('</svg>');
  return out.join('\n');
}
