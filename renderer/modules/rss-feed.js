/**
 * Modules France / Tech / Bourse / Sciences / Gaming / Santé — flux RSS
 * indépendants (remplacent l'ancien module "Actualités" à onglets unique).
 * Fetch direct via window.matin.rss.fetchFeed (proxy process main, aucune
 * restriction CORS) plutôt que rss2json.com utilisé par l'ancien module —
 * ce service renvoyait sporadiquement des erreurs 422/500 (même souci déjà
 * rencontré et abandonné pour le module Sports), le fetch direct + DOMParser
 * est plus fiable.
 *
 * France/Tech/Bourse/Gaming ont des sources RSS COCHABLES par l'utilisateur
 * (voir renderSourcesRssModule + france-sources.js/tech-sources.js/
 * bourse-sources.js/gaming-sources.js) ; Sciences/Santé gardent des sources
 * FIXES (voir RSS_FEED_DEFS/makeRssModule).
 *
 * Filtre d'âge 12h commun à TOUS ces modules (2026-09-01, sur demande
 * explicite, voir RSS_MAX_AGE_MS/rssFilterRecent) — "Aucune actualité
 * récente" si rien de moins de 12h.
 *
 * Affichage en ticker vertical défilant en boucle, même pattern que le
 * module Sports (voir ol.js) — réutilise ses classes CSS .sports-ticker-v*
 * (portée générique malgré le nom, même convention que crypto.js réutilisant
 * .etf-*). Vitesse : deux fois plus lente que Sports (durée d'animation
 * doublée pour un même nombre d'articles), sur demande explicite — le temps
 * de lire confortablement chaque titre.
 */
window.MatinModules = window.MatinModules || {};

// France/Tech/Bourse/Gaming retirées de RSS_FEED_DEFS (2026-09-01, sur
// demande explicite — France/Tech l'étaient déjà, Bourse/Gaming les
// rejoignent le même jour) — ont désormais leurs PROPRES sources cochables
// par l'utilisateur (voir renderSourcesRssModule plus bas + *-sources.js),
// au lieu d'une URL fixe ou d'une liste figée. Seules Sciences/Santé restent
// ici : sources FIXES, jamais proposées comme choix à l'utilisateur.
const RSS_FEED_DEFS = {
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
  // Actus sportives — passée à 2 sources EN PARALLÈLE le 2026-09-11, sur
  // demande explicite ("RMC Sport + Eurosport, mélangées et triées par date
  // décroissante") : `sources` (pas `url`) pour prendre la branche
  // multi-flux de makeRssModule ci-dessous, DÉJÀ le tri par date demandé
  // (`items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate))`,
  // partagée avec Sciences/Santé) — rien à ajouter côté rendu.
  //
  // Eurosport ABANDONNÉE, non ajoutée — vérifiée en direct ce jour-là :
  // `eurosport.fr/rss.xml` (URL demandée) → 404, ET la page d'accueil
  // elle-même → 403 (donc aucune balise d'autodiscovery consultable), ET 3
  // variantes d'URL supplémentaires → 404/403. Confirme, indépendamment, un
  // constat déjà documenté ailleurs dans ce projet (voir sports-sources.js/
  // bourse-sources.js) : Eurosport bloque tout accès non-navigateur au
  // niveau du site ENTIER, pas seulement son flux RSS — un problème de
  // blocage, pas une URL à corriger.
  //
  // Remplacée par L'ÉQUIPE (choix de l'utilisateur, AskUserQuestion, plutôt
  // que d'inventer une source non demandée) — mais l'URL PRÉCÉDEMMENT
  // configurée ici (lequipe.fr/rss/actu_rss.xml, seule source jusqu'ici)
  // s'est révélée ELLE AUSSI morte à la vérification (404, bug préexistant
  // découvert en passant, sans rapport avec Eurosport) : remplacée par
  // dwh.lequipe.fr/api/edito/rss?path=/Football, déjà vérifiée fonctionnelle
  // et utilisée ailleurs dans ce projet (voir sports-sources.js CATALOG.
  // football) — cohérent avec RMC Sport, football également (URL demandée :
  // .../rss/football/).
  sportNews: {
    sources: [
      'https://rmcsport.bfmtv.com/rss/football/',
      'https://dwh.lequipe.fr/api/edito/rss?path=/Football',
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

// Filtre d'âge maximum — 12h, TOUS les flux RSS de ce fichier (2026-09-01,
// sur demande explicite, REMPLACE le filtre 24h Bourse-seule introduit plus
// tôt le même jour) : un `pubDate` absent/invalide échoue le filtre (exclu),
// jamais affiché par défaut faute de preuve qu'il date de moins de 12h.
const RSS_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const RSS_NO_RECENT_ARTICLES_HTML = '<span class="module-empty">Aucune actualité récente</span>';

function rssFilterRecent(items) {
  const cutoff = Date.now() - RSS_MAX_AGE_MS;
  return items.filter(item => {
    const t = new Date(item.pubDate).getTime();
    return !isNaN(t) && t >= cutoff;
  });
}

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

// ─── Modules à sources cochables par l'utilisateur — France/Tech/Bourse/
// Gaming (2026-09-01, sur demande explicite) ────────────────────────────
// CONSOLIDÉ le même jour : France puis Tech avaient été implémentés comme 2
// fonctions quasi identiques (~70 lignes dupliquées), Bourse et Gaming
// auraient fait une 3e et 4e copie — remplacées par CETTE fonction générique
// unique, paramétrée par catalogue de sources/quota. Round-robin (PAS un tri
// par date puis troncature comme Sciences/Santé ci-dessous) : une seule
// source prolifique (ex. BFM TV) ne doit jamais noyer les autres sources
// cochées juste parce qu'elle publie plus souvent. Chaque module garde son
// PROPRE catalogue statique (voir france-sources.js/tech-sources.js/
// bourse-sources.js/gaming-sources.js, même convention de fichier partagé
// dashboard↔config que fdj-games.js).
// "Au moins 1 source cochée" (demandé explicitement pour chacun des 4
// modules) est imposé côté UI (voir config.js, meta.newsSourcesField) — ce
// module-ci se contente d'un repli défensif (`|| []`) si jamais
// `config.sources` finissait quand même vide.
function sourcesRssLabel(catalog, url) {
  return catalog?.find(s => s.url === url)?.label || url;
}

// Round-robin à quota (point commun à toutes les demandes) : prend l'article
// le plus récent de CHAQUE source à tour de rôle (pas plus de `quota` par
// source), jusqu'à épuiser toutes les sources.
function sourcesRssInterleave(bySource, quota) {
  const cursors = new Map(bySource.map(({ url }) => [url, 0]));
  const result = [];
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const { url, items } of bySource) {
      const idx = cursors.get(url);
      if (idx >= quota || idx >= items.length) continue;
      result.push(items[idx]);
      cursors.set(url, idx + 1);
      progressed = true;
    }
  }
  return result;
}

async function renderSourcesRssModule(feedKey, container, config, setBadge, { catalog, defaults, quota }) {
  setBadge('news');
  container.innerHTML = `
    <div class="sports-module">
      <div class="sports-ticker-vwrap" id="rss-ticker-${feedKey}">
        <div class="sports-ticker-vtrack">
          <div class="sports-ticker-vitem">Chargement…</div>
        </div>
      </div>
    </div>`;
  const tickerSlot = container.querySelector(`#rss-ticker-${feedKey}`);

  // `config.sources` absent/vide (jamais configuré, ou installation
  // existante d'avant cette fonctionnalité) → repli sur le(s) défaut(s) du
  // module (voir *-sources.js), le comportement d'origine avant l'ajout des
  // cases à cocher.
  const enabledUrls = Array.isArray(config?.sources) && config.sources.length
    ? config.sources
    : (defaults || []);

  try {
    const results = await Promise.allSettled(enabledUrls.map(url => rssFetchItems(url, 8)));
    const bySource = results.map((r, i) => {
      const url = enabledUrls[i];
      if (r.status === 'rejected') {
        console.warn(`[${feedKey}] Source indisponible: ${url}`, r.reason?.message);
        return { url, items: [] };
      }
      // Filtre 12h AVANT l'entrelacement (voir rssFilterRecent) — `quota`
      // borne le nombre d'articles RÉCENTS retenus par source, pas le
      // nombre brut fetché (8, marge suffisante pour filtrer sans perdre
      // d'articles réellement récents en RSS, trié plus récent d'abord).
      const recent = rssFilterRecent(r.value);
      return { url, items: recent.map(item => ({ ...item, sourceUrl: url })) };
    });

    const items = sourcesRssInterleave(bySource, quota);

    if (!items.length) {
      tickerSlot.innerHTML = RSS_NO_RECENT_ARTICLES_HTML;
      return;
    }

    // Libellé de source affiché à la place de l'heure relative (contrairement
    // à Sciences/Santé ci-dessous) : avec plusieurs sources cochables
    // mélangées, savoir QUI a publié chaque titre est plus utile que
    // "il y a 2h" — même rôle que .sports-ticker-source pour le ticker
    // d'actus Sports (voir ol.js), qui affiche déjà un libellé de source.
    const itemsHtml = items.map(item => `
      <div class="sports-ticker-vitem" data-link="${item.link}"><span class="sports-ticker-source">${sourcesRssLabel(catalog, item.sourceUrl)}</span>${item.title}</div>
    `).join('');

    const track = document.createElement('div');
    track.className = 'sports-ticker-vtrack';
    track.innerHTML = itemsHtml + itemsHtml;
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
}

// Sciences/Santé — sources FIXES (pas de choix utilisateur, voir
// RSS_FEED_DEFS en tête de fichier). Filtre 12h (point 1/3 de la demande
// "apply to ALL RSS modules") appliqué ici comme pour les modules à sources
// cochables ci-dessus — même constante RSS_MAX_AGE_MS/rssFilterRecent, même
// message "Aucune actualité récente" (point 2, message EXACT demandé,
// remplace l'ancien "Aucun article" générique ET l'ancien "Aucune actualité
// bourse aujourd'hui" Bourse-spécifique, Bourse étant désormais gérée par
// renderSourcesRssModule ci-dessus, pas ici).
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
          // Multi-sources (Sciences/Santé) : chaque flux fetché indépendamment
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

        items = rssFilterRecent(items);

        if (!items.length) {
          tickerSlot.innerHTML = RSS_NO_RECENT_ARTICLES_HTML;
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

// ─── Enregistrement des modules ─────────────────────────────────────────
// France/Tech/Bourse/Gaming : sources cochables (renderSourcesRssModule,
// catalogue + défauts propres à chacun, voir *-sources.js). Quota = 4
// partout (point 4 de chaque demande, "max per source").
window.MatinModules.france = {
  async render(container, config, _google, setBadge) {
    return renderSourcesRssModule('france', container, config, setBadge, {
      catalog: window.FRANCE_NEWS_SOURCES, defaults: window.FRANCE_DEFAULT_SOURCES, quota: 4,
    });
  },
};
window.MatinModules.tech = {
  async render(container, config, _google, setBadge) {
    return renderSourcesRssModule('tech', container, config, setBadge, {
      catalog: window.TECH_NEWS_SOURCES, defaults: window.TECH_DEFAULT_SOURCES, quota: 4,
    });
  },
};
window.MatinModules.bourse = {
  async render(container, config, _google, setBadge) {
    return renderSourcesRssModule('bourse', container, config, setBadge, {
      catalog: window.BOURSE_NEWS_SOURCES, defaults: window.BOURSE_DEFAULT_SOURCES, quota: 4,
    });
  },
};
window.MatinModules.gaming = {
  async render(container, config, _google, setBadge) {
    return renderSourcesRssModule('gaming', container, config, setBadge, {
      catalog: window.GAMING_NEWS_SOURCES, defaults: window.GAMING_DEFAULT_SOURCES, quota: 4,
    });
  },
};
window.MatinModules.science = makeRssModule('science');
window.MatinModules.sante = makeRssModule('sante');
window.MatinModules.sportNews = makeRssModule('sportNews');
