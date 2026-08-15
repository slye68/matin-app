/**
 * Module Promos Steam
 *
 * Remplace l'ancien module "Jeux gratuits Steam" (2026-08-10, sur demande
 * explicite) : liste les grosses remises Steam en cours (-50% ou plus) au
 * lieu des offres temporairement gratuites, trop rares pour être utiles au
 * quotidien. Voir main.js (IPC steamPromos:fetchDeals) pour la source
 * (`featuredcategories`, specials.items) et ses limites (plafonné à 10
 * entrées côté Valve).
 */
window.MatinModules = window.MatinModules || {};

function steamPromoPrice(cents, currency) {
  return (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (currency === 'EUR' ? '€' : currency);
}

function steamPromoItemHtml(game) {
  return `
    <div class="sp-item" data-url="${game.url}">
      ${game.image ? `<div class="sp-thumb" style="background-image:url('${game.image}')"></div>` : '<div class="sp-thumb sp-thumb-empty"></div>'}
      <div class="sp-info">
        <span class="sp-title">${game.title}</span>
        <span class="sp-prices">
          <span class="sp-price-original">${steamPromoPrice(game.originalPrice, game.currency)}</span>
          <span class="sp-price-final">${steamPromoPrice(game.finalPrice, game.currency)}</span>
        </span>
      </div>
      <span class="sp-discount">-${game.discountPercent}%</span>
    </div>`;
}

window.MatinModules.steamPromos = {
  async render(container, _config, _google, setBadge) {
    setBadge('…');
    container.innerHTML = `<div class="loading-spinner" style="margin:20px auto;width:18px;height:18px"></div>`;

    let games = [];
    try {
      games = await window.matin.steamPromos.fetchDeals();
    } catch (err) {
      console.warn('[Promos Steam] Indisponible', err);
      container.innerHTML = `<span class="module-error">Promos Steam indisponibles</span>`;
      setBadge('⚠');
      return;
    }

    if (!games.length) {
      container.innerHTML = `<div class="module-empty">Aucune promo Steam en ce moment.</div>`;
      setBadge('—');
      return;
    }

    container.innerHTML = `<div class="sp-list">${games.map(steamPromoItemHtml).join('')}</div>`;
    container.querySelectorAll('.sp-item').forEach(item => {
      item.addEventListener('click', () => window.matin.shell.openExternal(item.dataset.url));
    });

    setBadge(`${games.length}`);
  },
};
