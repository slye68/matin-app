/**
 * Module Suivi de prix Marchand (2026-08-30, sur demande explicite ; renommé
 * de "Amazon" à "Marchand" le 2026-08-31 — fonctionne avec n'importe quel
 * site e-commerce, pas seulement Amazon)
 *
 * Le fetch/parsing du prix vit ENTIÈREMENT côté process main depuis le
 * 2026-08-31 (voir main.js, `priceTracking:fetchPrice`) — avant cette date,
 * ce module appelait directement `window.matin.rss.fetchFeed` (jina.ai
 * seul). Suite à 2 rapports successifs ("Amazon bloque le scraping" puis
 * "échoue sur CDiscount et probablement d'autres sites"), la cascade
 * couvre maintenant plusieurs PROXYS (jina.ai → allorigins.win →
 * corsproxy.io → fetch direct → rainforestapi optionnelle) ET, pour chaque
 * réponse obtenue, plusieurs MOTIFS d'extraction (JSON-LD/CDiscount →
 * meta og:price → attributs/classes CSS → montant visible en dernier
 * recours) — centralisée côté main (seul endroit où la plupart de ces
 * proxys échappent à CORS, et où les en-têtes "navigateur réel"
 * personnalisés sont réellement appliqués). Ce fichier ne fait plus que
 * demander un prix et afficher le résultat.
 *
 * Dernier prix connu (2026-08-31, sur demande explicite) : si TOUTES les
 * combinaisons proxy/motif échouent, affiche `lastKnownPrice` (persisté
 * côté main, jamais remis à null par un échec — voir
 * priceTracking:reportPrices) avec la mention "(non mis à jour)" plutôt que
 * juste "Indisponible", tant qu'un prix a déjà été obtenu au moins une fois
 * par le passé.
 *
 * La persistance du dernier prix connu + la décision de notifier (passage
 * sous le prix cible) vivent côté process main (voir main.js,
 * priceTracking:reportPrices / USERDATA_MODULE_KEYS) : ce module se contente
 * de demander le prix ACTUEL de chaque produit et de transmettre le
 * résultat, une seule source de vérité pour la comparaison "prix précédent"
 * plutôt que de la dupliquer ici.
 *
 * AVERTISSEMENT : seul Amazon.fr a pu être testé en conditions réelles
 * jusqu'ici (succès confirmé via "fetch direct" + motif générique "XX,XX €",
 * voir CONTEXT.md) — les motifs JSON-LD/meta/CSS/CDiscount ajoutés le
 * 2026-08-31 sont des best-effort non encore vérifiés sur un vrai produit
 * CDiscount. À vérifier en priorité au premier usage réel sur un autre site
 * marchand : les logs `[Suivi de prix]` du process main (terminal
 * `npm run dev`) indiquent quel PROXY et quel MOTIF ont réussi ou échoué
 * pour chaque tentative (point 6 de la demande).
 */
window.MatinModules = window.MatinModules || {};

const PRICE_TRACKING_REFRESH_MS = 2 * 60 * 60 * 1000;

function priceTrend(current, previous) {
  if (previous == null || current === previous) return { icon: '→', cls: 'flat' };
  return current < previous ? { icon: '↓', cls: 'down' } : { icon: '↑', cls: 'up' };
}

function priceFmt(v) {
  return v != null ? `${v.toFixed(2)} €` : null;
}

function priceRowHtml(item) {
  const below = item.targetPrice != null && item.price != null && item.price <= item.targetPrice;
  const trend = priceTrend(item.price, item.previousPrice);
  // Point 5 de la demande : prix actuel s'il a pu être obtenu, sinon dernier
  // prix connu avec mention explicite qu'il n'est pas à jour — jamais
  // "Indisponible" sec tant qu'un prix a déjà été vu au moins une fois.
  const priceLabel = priceFmt(item.price)
    || (item.lastKnownPrice != null ? `${priceFmt(item.lastKnownPrice)} (non mis à jour)` : (item.error || '—'));

  return `
    <div class="price-tracking-row" data-url="${item.url}">
      <div class="price-tracking-main">
        <span class="price-tracking-label">${item.label || 'Produit'}</span>
        ${item.targetPrice != null ? `<span class="price-tracking-target">Objectif : ${priceFmt(item.targetPrice)}</span>` : ''}
      </div>
      <div class="price-tracking-value">
        ${below ? '<span class="price-tracking-alert-badge" title="Sous le prix cible">🔔</span>' : ''}
        <span class="price-tracking-trend price-tracking-trend-${trend.cls}">${trend.icon}</span>
        <span class="price-tracking-price${below ? ' price-tracking-price-alert' : (item.price == null && item.lastKnownPrice != null ? ' price-tracking-price-stale' : '')}">${priceLabel}</span>
      </div>
    </div>`;
}

window.MatinModules.priceTracking = {
  async render(container, config, _google, setBadge) {
    const items = (config?.items || []).filter(i => i.url);
    if (!items.length) {
      container.innerHTML = `<div class="module-empty">Ajoutez un produit Marchand à suivre dans Paramètres.</div>`;
      setBadge('—');
      return;
    }

    async function loadAndRender() {
      setBadge('…');

      const fetched = await Promise.all(items.map(async (item) => {
        try {
          const { price, method } = await window.matin.priceTracking.fetchPrice(item.url);
          return { url: item.url, label: item.label, targetPrice: item.targetPrice, price, fetchMethod: method, error: null };
        } catch (err) {
          console.warn(`[Suivi de prix] ${item.label || item.url}`, err.message);
          return { url: item.url, label: item.label, targetPrice: item.targetPrice, price: null, fetchMethod: null, error: 'Indisponible' };
        }
      }));

      // Persistance + comparaison au prix précédent + notification, côté
      // process main (voir en-tête du fichier) — `saved` renvoie chaque
      // produit enrichi de `previousPrice`/`lastKnownPrice`, calculés là-bas.
      let merged = fetched;
      try {
        merged = await window.matin.priceTracking.reportPrices(fetched);
      } catch (err) {
        console.error('[Suivi de prix] Échec de la persistance des prix', err);
      }

      container.innerHTML = `<div class="price-tracking-module"><div class="price-tracking-list">${merged.map(priceRowHtml).join('')}</div></div>`;
      container.querySelectorAll('.price-tracking-row').forEach((row) => {
        row.addEventListener('click', () => window.matin.shell.openExternal(row.dataset.url));
      });

      const alerts = merged.filter(m => m.targetPrice != null && m.price != null && m.price <= m.targetPrice).length;
      setBadge(alerts ? `🔔 ${alerts}` : `${merged.length}`);
    }

    container.innerHTML = `<div class="loading-spinner" style="margin:20px auto;width:18px;height:18px"></div>`;
    await loadAndRender();

    setInterval(() => {
      loadAndRender().catch(err => console.error('[Suivi de prix] Erreur auto-refresh', err));
    }, PRICE_TRACKING_REFRESH_MS);
  },
};
