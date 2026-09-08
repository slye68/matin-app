/**
 * Module Liste de souhaits (2026-09-08, sur demande explicite — refonte
 * complète, remplace l'ancien "Suivi de prix Marchand") : liste STATIQUE
 * saisie à la main dans Paramètres (label/vendeur/URL/budget approximatif/
 * prioritaire), plus AUCUN fetch réseau — l'ancienne cascade de proxys/motifs
 * d'extraction de prix (jina.ai/allorigins/corsproxy/fetch direct/
 * rainforestapi, voir main.js PRICE_PROXIES) est entièrement retirée de ce
 * fichier. `main.js` conserve encore `priceTracking:fetchPrice`/
 * `priceTracking:reportPrices` (canaux IPC) — devenus inutilisés, mais
 * laissés en place tels quels, hors du périmètre de cette demande.
 *
 * Chaque item : { label, vendor, url, budget, priority }. Une ligne entière
 * est cliquable → ouvre `item.url` dans le navigateur externe, avec les MÊMES
 * garde-fous anti-"ouverture Explorateur Windows au lieu du navigateur" que
 * l'ancien module (voir plus bas) : le risque qu'ils corrigent (URL mal
 * formée/tronquée réinterprétée par Electron comme un chemin de fichier
 * local) ne dépend pas de ce que la ligne affiche, ils restent donc
 * nécessaires tels quels.
 */
window.MatinModules = window.MatinModules || {};

// Ligne "Liste de souhaits" — ⭐ (si prioritaire) | Nom | Vendeur | Budget.
// Vendeur/budget réutilisent `.price-tracking-merchant` (déjà en place,
// texte discret/atténué — voir style.css) plutôt qu'une nouvelle classe par
// champ : les deux jouent exactement le même rôle visuel ("info secondaire à
// côté du nom"), aucune raison de dupliquer la règle.
function wishlistRowHtml(item) {
  const vendor = (item.vendor || '').trim();
  const budget = (item.budget || '').trim();
  return `
    <div class="price-tracking-row" data-url="${encodeURIComponent(item.url || '')}">
      <div class="price-tracking-main">
        ${item.priority === true ? '<span class="price-tracking-star" style="color:#f59e0b">⭐</span>' : ''}
        <span class="price-tracking-label">${item.label}</span>
      </div>
      ${vendor ? `<span class="price-tracking-merchant">${vendor}</span>` : ''}
      ${budget ? `<span class="price-tracking-merchant">${budget}</span>` : ''}
    </div>`;
}

window.MatinModules.priceTracking = {
  async render(container, config, _google, setBadge) {
    // Filtre les items sans label — un item ajouté puis jamais rempli (voir
    // config.js renderPriceTrackingConfigSection) ne doit pas apparaître
    // comme une ligne vide.
    const items = (config?.items || []).filter(i => i.label);

    if (!items.length) {
      container.innerHTML = `<div class="module-empty">Ajoutez un article dans Paramètres.</div>`;
      setBadge('—');
      return;
    }

    container.innerHTML = `<div class="price-tracking-module"><div class="price-tracking-list">${items.map(wishlistRowHtml).join('')}</div></div>`;

    // Correctif "clic → Explorateur Windows au lieu du navigateur" — repris
    // TEL QUEL de l'ancien module : `data-url` encodé (une URL brute avec
    // `&`/`=`/espaces non encodés casse la valeur de l'attribut HTML) +
    // décodage/validation en 3 temps avant tout `openExternal` (URL
    // décodable, schéma reconnu par `new URL`, et STRICTEMENT http/https —
    // jamais `file:`/`javascript:`/autre, même "valide" au sens de `new
    // URL`). Rien n'est ouvert et un avertissement est loggué si l'un des 3
    // contrôles échoue.
    container.querySelectorAll('.price-tracking-row').forEach((row) => {
      row.addEventListener('click', () => {
        const rawUrl = row.dataset.url;
        if (!rawUrl) return;

        let decodedUrl;
        try {
          decodedUrl = decodeURIComponent(rawUrl);
        } catch (err) {
          console.warn(`[Liste de souhaits] URL invalide, impossible d'ouvrir : ${rawUrl}`);
          return;
        }

        let parsedUrl;
        try {
          parsedUrl = new URL(decodedUrl);
        } catch (err) {
          console.warn(`[Liste de souhaits] URL invalide, impossible d'ouvrir : ${decodedUrl}`);
          return;
        }
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          console.warn(`[Liste de souhaits] URL invalide, impossible d'ouvrir : ${decodedUrl}`);
          return;
        }

        console.log(`[Liste de souhaits] Ouverture URL : ${decodedUrl}`);
        window.matin.shell.openExternal(decodedUrl);
      });
    });

    setBadge(String(items.length));
  },
};
