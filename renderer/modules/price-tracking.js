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
 * AVERTISSEMENT : seul Amazon.fr a pu être testé en conditions réelles pour
 * un cycle fetch → prix affiché de bout en bout (succès confirmé via
 * "fetch direct" + motif générique "XX,XX €", voir CONTEXT.md). Pour
 * CDiscount, débuggé le 2026-09-03 (voir main.js, longue note sur
 * PRICE_PROXIES) : CDiscount sert un challenge anti-bot JS ("Baleen") à tout
 * fetch serveur-à-serveur (confirmé en direct — "fetch direct" ne reçoit
 * QUE la page de challenge, jamais le produit), seul jina.ai passe ce
 * challenge (confirmé), mais sa conversion en markdown supprime
 * structurellement `<script>`/`<meta>`/classes CSS — sur CDiscount via
 * jina.ai, seul le motif générique "XX,XX €" visible dans le texte a une
 * chance réelle de matcher, les motifs JSON-LD/meta/CSS restent surtout
 * utiles aux AUTRES sites marchands (Amazon, FNAC...). Les logs
 * `[Suivi de prix]`/`[Suivi de prix][CDiscount]` du process main (terminal
 * `npm run dev`) indiquent quel PROXY et quel MOTIF ont réussi ou échoué
 * pour chaque tentative (point 6 de la demande initiale, point 5 du debug
 * CDiscount du 2026-09-03).
 */
window.MatinModules = window.MatinModules || {};

const PRICE_TRACKING_REFRESH_MS = 2 * 60 * 60 * 1000;

function priceFmt(v) {
  return v != null ? `${v.toFixed(2)} €` : null;
}

// Nom du marchand (2026-09-01, sur demande explicite — remplace l'ancienne
// extraction depuis le domaine de l'URL, ex. "(Fnac)" depuis "www.fnac.com")
// par le champ "Vendeur" saisi À LA MAIN par l'utilisateur dans Paramètres
// (voir config.js renderPriceTrackingConfigSection, `item.vendor`) : affiché
// TEL QUEL, jamais recalculé ou déduit de l'URL. `null` si laissé vide
// (espaces compris), jamais affiché dans ce cas.
function priceVendorLabel(vendor) {
  const trimmed = (vendor || '').trim();
  return trimmed || null;
}

// Pastille de statut (2026-08-31, sur demande explicite, redesign compact —
// remplace la flèche de tendance ↑/↓/→ ET le badge 🔔, tous deux retirés) :
// compare le prix ACTUEL au prix CIBLE plutôt que le prix actuel au prix
// précédent — répond directement à "ai-je atteint mon objectif ?", la
// question que pose ce module, plutôt qu'à "le prix a-t-il bougé depuis la
// dernière vérification ?". Grise si l'objectif OU le prix actuel est
// inconnu — jamais rouge par défaut sur une donnée manquante, qui laisserait
// croire à tort que le prix est au-dessus de l'objectif.
function priceStatusDot(item) {
  if (item.targetPrice == null) return { color: '#6b7280', title: "Pas d'objectif défini" };
  if (item.price == null) return { color: '#6b7280', title: 'Prix actuel inconnu' };
  return item.price <= item.targetPrice
    ? { color: '#34d399', title: `Prix atteint (objectif : ${priceFmt(item.targetPrice)})` }
    : { color: '#ef4444', title: `Au-dessus de l'objectif (${priceFmt(item.targetPrice)})` };
}

function priceRowHtml(item) {
  const below = item.targetPrice != null && item.price != null && item.price <= item.targetPrice;
  const dot = priceStatusDot(item);
  const merchant = priceVendorLabel(item.vendor);
  // Point 5 de la demande initiale : prix actuel s'il a pu être obtenu,
  // sinon dernier prix connu avec mention explicite qu'il n'est pas à jour —
  // jamais "Indisponible" sec tant qu'un prix a déjà été vu au moins une fois.
  const priceLabel = priceFmt(item.price)
    || (item.lastKnownPrice != null ? `${priceFmt(item.lastKnownPrice)} (non mis à jour)` : (item.error || '—'));

  // `data-url` encodé (2026-09-03, sur demande explicite, correctif clic →
  // Explorateur Windows) — une URL brute contenant `&`/`=`/espaces non
  // encodés casse la valeur de l'attribut HTML au premier caractère
  // problématique (ex. un `&` non échappé y est lu comme le début d'une
  // entité HTML), tronquant silencieusement l'URL stockée dans le DOM ; le
  // fragment tronqué qui en résulte n'a plus de schéma/forme valide, ce
  // qu'Electron interprète alors comme un CHEMIN DE FICHIER LOCAL plutôt
  // qu'une URL web, d'où l'ouverture de l'Explorateur au lieu du navigateur.
  // `encodeURIComponent` ici + `decodeURIComponent` au clic (voir plus bas)
  // évite ce risque quel que soit le contenu de l'URL saisie.
  return `
    <div class="price-tracking-row" data-url="${encodeURIComponent(item.url)}">
      <div class="price-tracking-main">
        <span class="price-tracking-label">${item.label || 'Produit'}</span>
        ${merchant ? `<span class="price-tracking-merchant">(${merchant})</span>` : ''}
        ${item.targetPrice != null ? `<span class="price-tracking-target">Objectif : ${priceFmt(item.targetPrice)}</span>` : ''}
      </div>
      <div class="price-tracking-value">
        <span class="price-tracking-dot" style="background:${dot.color}" title="${dot.title}"></span>
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
          return { url: item.url, label: item.label, vendor: item.vendor, targetPrice: item.targetPrice, price, fetchMethod: method, error: null };
        } catch (err) {
          console.warn(`[Suivi de prix] ${item.label || item.url}`, err.message);
          return { url: item.url, label: item.label, vendor: item.vendor, targetPrice: item.targetPrice, price: null, fetchMethod: null, error: 'Indisponible' };
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
      // Correctif "clic → Explorateur Windows au lieu du navigateur"
      // (2026-09-03, sur demande explicite) — 3 garde-fous avant tout appel
      // à `openExternal` : 1) décoder `data-url` (voir priceRowHtml, encodé
      // avec encodeURIComponent) ; 2) `new URL(...)` dans un try/catch — une
      // URL mal formée (sans schéma, tronquée...) lève une exception ici
      // plutôt que d'être passée telle quelle à Electron, qui la
      // réinterprète alors comme un chemin de fichier local ; 3) le schéma
      // DOIT être http/https — jamais `file:`/`javascript:`/autre, même si
      // techniquement "valide" au sens de `new URL`. Rien n'est ouvert et un
      // warning explicite est loggué si l'un de ces 3 contrôles échoue.
      container.querySelectorAll('.price-tracking-row').forEach((row) => {
        row.addEventListener('click', () => {
          const rawUrl = row.dataset.url;
          if (!rawUrl) return;

          let decodedUrl;
          try {
            decodedUrl = decodeURIComponent(rawUrl);
          } catch (err) {
            console.warn(`[Suivi de prix] URL invalide, impossible d'ouvrir : ${rawUrl}`);
            return;
          }

          let parsedUrl;
          try {
            parsedUrl = new URL(decodedUrl);
          } catch (err) {
            console.warn(`[Suivi de prix] URL invalide, impossible d'ouvrir : ${decodedUrl}`);
            return;
          }
          if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            console.warn(`[Suivi de prix] URL invalide, impossible d'ouvrir : ${decodedUrl}`);
            return;
          }

          console.log(`[Suivi de prix] Ouverture URL : ${decodedUrl}`);
          window.matin.shell.openExternal(decodedUrl);
        });
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
