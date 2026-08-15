/**
 * Module Change — convertisseur de devises en direct, aucune clé requise.
 *
 * open.er-api.com retenu plutôt que frankfurter.app (suggéré par la demande,
 * en alternative) — vérifié en direct (2026-08-06) : frankfurter.app ne
 * couvre que les ~30 devises de référence de la BCE (ni MAD ni TND, deux
 * devises explicitement demandées), open.er-api.com en couvre 166 (MAD/TND
 * confirmés présents) et renvoie `access-control-allow-origin: *` (CORS
 * ouvert, vérifié) — fetch direct depuis le renderer comme CoinGecko
 * (crypto.js), pas besoin du proxy process main (rss:fetchFeed).
 *
 * Un seul appel par devise "source" renvoie le taux vers TOUTES les devises
 * cibles à la fois (`/v6/latest/{FROM}` → `{ rates: { USD, GBP, ... } }`) :
 * mis en cache par devise source pendant 1h (CURRENCY_REFRESH_MS), réutilisé
 * pour tout changement de devise "cible" ou de montant sans nouvel appel.
 *
 * Pas de config persistée (comme maps.js) : la sélection des 2 devises et le
 * montant vivent en état local du module, remis à zéro à chaque rechargement
 * du dashboard — cohérent avec le fait qu'il n'y a pas de section dédiée dans
 * Paramètres. Auto-refresh interne (comme etf.js/crypto.js/spotify.js) plutôt
 * que le refreshMs générique de dashboard.js : un re-render externe qui
 * recrée le innerHTML effacerait le montant et les devises en cours de
 * saisie.
 */
window.MatinModules = window.MatinModules || {};

const CURRENCY_LIST = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD', 'AUD', 'CNY', 'MAD', 'TND'];
const CURRENCY_REFRESH_MS = 60 * 60 * 1000;

// Cache partagé entre toutes les instances du module (une seule en pratique) —
// clé = devise source, évite un appel réseau à chaque changement de devise
// cible ou de montant puisqu'un seul appel donne déjà tous les taux.
const CURRENCY_RATE_CACHE = {};

async function currencyFetchRates(from) {
  const cached = CURRENCY_RATE_CACHE[from];
  if (cached && Date.now() - cached.fetchedAt < CURRENCY_REFRESH_MS) return cached.rates;

  const res = await fetch(`https://open.er-api.com/v6/latest/${from}`);
  if (!res.ok) throw new Error(`Taux de change indisponible (${res.status})`);
  const data = await res.json();
  if (data.result !== 'success' || !data.rates) throw new Error('Réponse invalide (open.er-api.com)');

  CURRENCY_RATE_CACHE[from] = { rates: data.rates, fetchedAt: Date.now() };
  return data.rates;
}

function currencyOptionsHtml(selected) {
  return CURRENCY_LIST.map(c => `<option value="${c}" ${c === selected ? 'selected' : ''}>${c}</option>`).join('');
}

window.MatinModules.currency = {
  async render(container, _config, _google, setBadge) {
    let from = 'EUR';
    let to = 'USD';
    let rates = null;

    container.innerHTML = `
      <div class="currency-module">
        <div class="currency-row">
          <input type="number" class="currency-amount-input" min="0" step="0.01" value="100" inputmode="decimal">
          <select class="currency-select" data-side="from">${currencyOptionsHtml(from)}</select>
        </div>
        <button type="button" class="currency-swap-btn" title="Inverser les devises">⇄</button>
        <div class="currency-row currency-row-result">
          <span class="currency-result">…</span>
          <select class="currency-select" data-side="to">${currencyOptionsHtml(to)}</select>
        </div>
        <div class="currency-meta">…</div>
      </div>`;

    const amountInput = container.querySelector('.currency-amount-input');
    const fromSelect = container.querySelector('[data-side="from"]');
    const toSelect = container.querySelector('[data-side="to"]');
    const resultEl = container.querySelector('.currency-result');
    const metaEl = container.querySelector('.currency-meta');
    const swapBtn = container.querySelector('.currency-swap-btn');

    function recompute() {
      if (!rates) return;
      const rate = rates[toSelect.value];
      const amount = parseFloat(amountInput.value) || 0;
      if (typeof rate !== 'number') {
        resultEl.textContent = '—';
        metaEl.textContent = 'Devise indisponible pour cette source';
        return;
      }
      resultEl.textContent = `${(amount * rate).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${toSelect.value}`;
      metaEl.textContent = `1 ${fromSelect.value} = ${rate.toLocaleString('fr-FR', { maximumFractionDigits: 4 })} ${toSelect.value}`;
      setBadge(toSelect.value);
    }

    async function refreshRates() {
      resultEl.textContent = '…';
      metaEl.textContent = 'Mise à jour du taux…';
      setBadge('…');
      try {
        rates = await currencyFetchRates(fromSelect.value);
        recompute();
      } catch (err) {
        resultEl.textContent = '—';
        metaEl.textContent = 'Taux indisponible — réessai auto dans 1h';
        console.error('[Change]', err);
        setBadge('⚠');
      }
    }

    amountInput.addEventListener('input', recompute);
    toSelect.addEventListener('change', recompute);
    fromSelect.addEventListener('change', refreshRates);
    swapBtn.addEventListener('click', () => {
      const tmp = fromSelect.value;
      fromSelect.value = toSelect.value;
      toSelect.value = tmp;
      refreshRates();
    });

    await refreshRates();
    setInterval(refreshRates, CURRENCY_REFRESH_MS);
  },
};
