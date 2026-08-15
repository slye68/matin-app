/**
 * Module Promos Epic Games
 *
 * Même style que Promos Steam (2026-08-10, sur demande explicite) — réutilise
 * directement les classes CSS .sp-* (liste déroulante, voir style.css) plutôt
 * que de dupliquer un style quasi identique sous un autre préfixe.
 *
 * Voir main.js (IPC epicPromos:fetchDeals) pour la source et ses limites :
 * l'endpoint ouvert (freeGamesPromotions) ne couvre que le rail "Jeux
 * gratuits" de la boutique (gratuits + quelques réductions ponctuelles de ce
 * même rail), PAS un scan storewide des soldes Epic — les 2 autres sources
 * demandées (GraphQL, page /deals) sont bloquées par Cloudflare et n'ont pas
 * été contournées (hors politique).
 *
 * Titre de carte cliquable → https://store.epicgames.com/fr/free-games : PAS
 * géré ici, voir dashboard.js MODULE_CLICK_URLS (mécanisme déjà générique et
 * partagé, ex. Spotify/Calendar/Gmail — pas la peine d'un câblage local par
 * module).
 */
window.MatinModules = window.MatinModules || {};

function epicPromoPrice(cents, currency) {
  return (cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + (currency === 'EUR' ? '€' : currency);
}

function epicPromoItemHtml(game) {
  return `
    <div class="sp-item" data-url="${game.url}">
      ${game.image ? `<div class="sp-thumb" style="background-image:url('${game.image}')"></div>` : '<div class="sp-thumb sp-thumb-empty"></div>'}
      <div class="sp-info">
        <span class="sp-title">${game.title}</span>
        <span class="sp-prices">
          <span class="sp-price-original">${epicPromoPrice(game.originalPrice, game.currency)}</span>
          <span class="sp-price-final">${epicPromoPrice(game.finalPrice, game.currency)}</span>
        </span>
      </div>
      <span class="sp-discount">${game.isFree ? 'GRATUIT' : `-${game.discountPercent}%`}</span>
    </div>`;
}

window.MatinModules.epicPromos = {
  async render(container, _config, _google, setBadge) {
    setBadge('…');
    container.innerHTML = `<div class="loading-spinner" style="margin:20px auto;width:18px;height:18px"></div>`;

    let games = [];
    try {
      games = await window.matin.epicPromos.fetchDeals();
    } catch (err) {
      console.warn('[Promos Epic Games] Indisponible', err);
      container.innerHTML = `<span class="module-error">Promos Epic Games indisponibles</span>`;
      setBadge('⚠');
      return;
    }

    if (!games.length) {
      container.innerHTML = `<div class="module-empty">Aucune promo Epic Games en ce moment.</div>`;
      setBadge('—');
      return;
    }

    container.innerHTML = `<div class="sp-list">${games.map(epicPromoItemHtml).join('')}</div>`;
    container.querySelectorAll('.sp-item').forEach(item => {
      item.addEventListener('click', () => window.matin.shell.openExternal(item.dataset.url));
    });

    setBadge(`${games.length}`);
  },
};
