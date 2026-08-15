/**
 * Modules France / Tech / Bourse — flux RSS indépendants (remplacent l'ancien
 * module "Actualités" à onglets unique). Fetch direct via
 * window.matin.rss.fetchFeed (proxy process main, aucune restriction CORS)
 * plutôt que rss2json.com utilisé par l'ancien module — ce service renvoyait
 * sporadiquement des erreurs 422/500 (même souci déjà rencontré et abandonné
 * pour le module Sports), le fetch direct + DOMParser est plus fiable.
 *
 * URL 01net corrigée : l'ancienne (/rss/news/) renvoie un 404 (vérifié) — la
 * bonne est /feed/.
 *
 * Affichage en ticker vertical défilant en boucle, même pattern que le
 * module Sports (voir ol.js) — réutilise ses classes CSS .sports-ticker-v*
 * (portée générique malgré le nom, même convention que crypto.js réutilisant
 * .etf-*). Vitesse : deux fois plus lente que Sports (durée d'animation
 * doublée pour un même nombre d'articles), sur demande explicite — le temps
 * de lire confortablement chaque titre.
 */
window.MatinModules = window.MatinModules || {};

const RSS_FEED_DEFS = {
  france: { url: 'https://www.lemonde.fr/rss/une.xml' },
  tech:   { url: 'https://www.01net.com/feed/' },
  bourse: { url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EFCHI&region=FR&lang=fr-FR' },
  // Sciences (2026-08-06) — 3 sources demandées, chacune vérifiée en direct.
  // nationalgeographic.fr/rss (URL demandée) renvoie un 404 RÉEL (page
  // d'erreur HTML, pas du XML) : aucun tag d'autodiscovery RSS sur son
  // homepage, mais un href brut vers /api/rss/latest_contents.xml trouvé dans
  // le HTML (pas un lien de nav visible) — vérifié, renvoie bien du XML valide.
  science: {
    sources: [
      'https://www.sciencesetavenir.fr/rss.xml',
      'https://www.futura-sciences.com/rss/actualites.xml',
      'https://www.nationalgeographic.fr/api/rss/latest_contents.xml',
    ],
  },
  // Gaming (2026-08-06) — 2 sources max demandées, les 2 URLs fournies
  // fonctionnent telles quelles (vérifié en direct, pas de 404 cette fois).
  gaming: {
    sources: [
      'https://www.jeuxvideo.com/rss/rss.xml',
      'https://fr.ign.com/feed.xml',
    ],
  },
  // Santé (2026-08-07) — 3 sources demandées, vérifiées en direct via jina.ai
  // (une vraie page "introuvable"/404 rendue pour chacune, pas un blocage
  // bot) : les 3 URLs fournies sont mortes.
  //   - doctissimo.fr/rss.xml → 404 ; la vraie URL trouvée via la balise
  //     d'autodiscovery RSS de la page d'accueil est doctissimo.fr/feed.
  //   - lequotidiendumedecin.fr/feed → 404 ; /rss.xml fonctionne à la place
  //     (aucune balise d'autodiscovery trouvée sur la page d'accueil, testé
  //     par tâtonnement à partir du motif qui a marché pour Doctissimo).
  //   - pourquoidocteur.fr/feed → 410 Gone ; /feed/, /rss.xml également morts
  //     (410/403), et aucune balise d'autodiscovery ni aucun href contenant
  //     "rss"/"feed" nulle part sur sa page d'accueil — abandonné, même
  //     constat que pour Eurosport/AlloCiné (voir plus haut) : le flux
  //     semble avoir été retiré du site, pas juste déplacé.
  sante: {
    sources: [
      'https://www.doctissimo.fr/feed',
      'https://www.lequotidiendumedecin.fr/rss.xml',
    ],
  },
};

// Sports (ol.js) utilise `items.length * 6, min 24s` (relevé de 5/20 le
// 2026-08-05 — items passés à 3 lignes pleines, voir .sports-ticker-vitem
// dans style.css) — deux fois plus lent ici : facteur par article doublé ET
// plancher doublé, pour que la lenteur relative tienne même avec peu
// d'articles (pas seulement avec beaucoup).
const RSS_TICKER_SEC_PER_ITEM = 12;
const RSS_TICKER_MIN_SEC = 48;

function rssRelativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor(diff / 60000);
  if (h > 24) return `il y a ${Math.floor(h / 24)}j`;
  if (h > 0)  return `il y a ${h}h`;
  if (m > 0)  return `il y a ${m} min`;
  return 'à l\'instant';
}

// Récupère et parse un seul flux XML — factorisé pour le cas multi-sources
// (Sciences/Gaming) qui doit fetcher plusieurs flux en parallèle sans qu'un
// seul en échec ne fasse tomber les autres (même principe que le filtrage
// par source du module Sports, voir ol.js/CONTEXT.md : jamais de repli
// agrégateur qui masquerait quelle source a réellement échoué).
async function rssFetchItems(url, limit) {
  const xmlText = await window.matin.rss.fetchFeed(url);
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML invalide');
  return Array.from(doc.querySelectorAll('item')).slice(0, limit).map(item => ({
    title: item.querySelector('title')?.textContent || '',
    link: item.querySelector('link')?.textContent || '',
    pubDate: item.querySelector('pubDate')?.textContent || '',
  }));
}

function makeRssModule(feedKey) {
  return {
    async render(container, _config, _google, setBadge) {
      const feed = RSS_FEED_DEFS[feedKey];
      setBadge('news');
      // Enveloppe flex-column (.sports-module, réutilisée) nécessaire : .sports-
      // ticker-vwrap dépend de `flex:1;min-height:0` sur un parent flex pour
      // obtenir une hauteur bornée (sinon `overflow:hidden` ne "fenêtre" rien,
      // le wrap grandit pour montrer les items dupliqués en entier) — exactement
      // le rôle que .sports-module joue déjà pour le ticker du module Sports.
      container.innerHTML = `
        <div class="sports-module">
          <div class="sports-ticker-vwrap" id="rss-ticker-${feedKey}">
            <div class="sports-ticker-vtrack">
              <div class="sports-ticker-vitem">Chargement…</div>
            </div>
          </div>
        </div>`;
      const tickerSlot = container.querySelector(`#rss-ticker-${feedKey}`);

      try {
        let items;
        if (feed.sources) {
          // Multi-sources (Sciences/Gaming) : chaque flux fetché indépendamment
          // (Promise.allSettled, pas Promise.all) — une source en panne ne doit
          // pas faire disparaître les autres, juste contribuer 0 article.
          const results = await Promise.allSettled(feed.sources.map(url => rssFetchItems(url, 8)));
          results.forEach((r, i) => {
            if (r.status === 'rejected') console.warn(`[${feedKey}] Source indisponible: ${feed.sources[i]}`, r.reason?.message);
          });
          items = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
          items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
          items = items.slice(0, 12);
        } else {
          items = await rssFetchItems(feed.url, 10);
        }

        if (!items.length) {
          tickerSlot.innerHTML = `<span class="module-empty">Aucun article</span>`;
          return;
        }

        const itemsHtml = items.map(item => `
          <div class="sports-ticker-vitem" data-link="${item.link}"><span class="sports-ticker-source">${rssRelativeTime(item.pubDate)}</span>${item.title}</div>
        `).join('');

        const track = document.createElement('div');
        track.className = 'sports-ticker-vtrack';
        track.innerHTML = itemsHtml + itemsHtml; // dupliqué : boucle continue sans à-coup (voir @keyframes sports-ticker-v, translateY -50%)
        track.style.animationDuration = `${Math.max(items.length * RSS_TICKER_SEC_PER_ITEM, RSS_TICKER_MIN_SEC)}s`;

        tickerSlot.innerHTML = '';
        tickerSlot.appendChild(track);

        tickerSlot.querySelectorAll('.sports-ticker-vitem').forEach(el => {
          el.addEventListener('click', () => {
            const link = el.dataset.link;
            if (link) window.matin.shell.openExternal(link);
          });
        });
      } catch (err) {
        tickerSlot.innerHTML = `<span class="module-error">Flux indisponible</span>`;
        console.error(`[${feedKey}]`, err);
      }
    },
  };
}

window.MatinModules.france = makeRssModule('france');
window.MatinModules.tech = makeRssModule('tech');
window.MatinModules.bourse = makeRssModule('bourse');
window.MatinModules.science = makeRssModule('science');
window.MatinModules.gaming = makeRssModule('gaming');
window.MatinModules.sante = makeRssModule('sante');
