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
// `description` ajoutée (2026-09-22, sur demande explicite — refonte
// visuelle Tech, voir plus bas) : strictement ADDITIVE, un champ de plus
// extrait du même XML déjà téléchargé pour chaque `<item>`, aucune nouvelle
// URL/source/requête. Les appelants existants (France/Bourse/Gaming/
// Sciences/Santé) détruisent déjà le résultat en `{title, link, pubDate}` —
// ils ignorent silencieusement ce champ, aucun changement de comportement
// pour eux.
async function rssFetchItems(url, limit) {
  const xmlText = await window.matin.rss.fetchFeed(url);
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML invalide');
  return Array.from(doc.querySelectorAll('item')).slice(0, limit).map(item => ({
    title: item.querySelector('title')?.textContent || '',
    link: item.querySelector('link')?.textContent || '',
    pubDate: item.querySelector('pubDate')?.textContent || '',
    description: item.querySelector('description')?.textContent || '',
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

// Extrait le fetch+filtre+entrelacement communs à TOUS les modules à
// sources cochables (2026-09-22, EXTRACTION pure depuis le corps de
// renderSourcesRssModule ci-dessous — AUCUN changement de comportement,
// mêmes appels/mêmes conditions dans le même ordre, voir git diff) : rendue
// nécessaire par le nouveau rendu dédié Tech (plus bas), qui a besoin des
// `items` bruts pour afficher un extrait — chose que renderSourcesRssModule
// ne peut pas lui fournir, puisqu'elle écrit directement le HTML final sans
// jamais renvoyer les items à son appelant. Réutilisée telle quelle par les
// deux, plutôt que dupliquée : mêmes sources/filtre 12h/quota par source
// pour Tech que pour France/Bourse/Gaming, un seul endroit à faire évoluer.
async function sourcesRssFetchInterleaved(feedKey, enabledUrls, quota) {
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
  return sourcesRssInterleave(bySource, quota);
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
    const items = await sourcesRssFetchInterleaved(feedKey, enabledUrls, quota);

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

// `makeRssModule` — SUPPRIMÉE (2026-09-24) : servait Sciences puis Santé,
// toutes les deux passées à un rendu propre depuis (voir window.MatinModules.
// science plus bas, window.MatinModules.sante plus bas) — plus aucun
// appelant. `RSS_FEED_DEFS`/`rssFetchItems`/`rssFilterRecent`/
// `RSS_NO_RECENT_ARTICLES_HTML` restent utilisées, inchangées.

// ─── France — habillage visuel dédié "tricolore" (2026-09-23, sur demande
// explicite, maquette + valeurs précises fournies) ──────────────────────────
// PÉRIMÈTRE : réutilise TEL QUEL rssFetchItems/rssFilterRecent/
// sourcesRssInterleave/sourcesRssLabel/sourcesRssFetchInterleaved (mêmes
// sources cochables, même filtre 12h, même quota/source) — AUCUNE touche à
// ces fonctions, ni à `renderSourcesRssModule` (toujours utilisée telle
// quelle par Bourse, qui garde sa propre apparence actuelle inchangée).
// Contrairement à Gaming (qui appelle la fonction partagée puis enrichit le
// DOM après coup) : la demande veut ici un gabarit de ligne entièrement
// différent (source colorée en haut/titre 2 lignes/date+chevron, sans
// extrait) qui ne peut pas se limiter à décorer `.sports-ticker-vitem`
// existant — France a donc son propre rendu d'item, comme Tech, mais garde
// EXPLICITEMENT `.sports-ticker-vwrap`/`.sports-ticker-vtrack` (demandé
// littéralement, "classes .sports-ticker-v*") pour le défilement en boucle
// et la hauteur flexible — déjà `flex:1;min-height:0` par défaut, aucun
// correctif de hauteur nécessaire ici (contrairement à Tech avant sa propre
// demande de retouche).
const FRANCE_FLAG_SVG = `<svg viewBox="0 0 24 16" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="8" height="16" fill="#002654"/>
  <rect x="8" y="0" width="8" height="16" fill="#ffffff"/>
  <rect x="16" y="0" width="8" height="16" fill="#ed2939"/>
</svg>`;

// Couleur du libellé de source (2026-09-23, sur demande explicite, valeurs
// données une par une) — clé = LIBELLÉ tel qu'affiché (voir
// france-sources.js), pas l'URL. Écart signalé : "L'Obs" n'existe PAS dans
// le catalogue réel de ce module (voir window.FRANCE_NEWS_SOURCES — Le
// Monde/Le Figaro/BFM TV/France Info/Libération, 5 sources ; jamais eu de
// "L'Obs") — gardée ici telle quelle (n'aurait simplement jamais de
// correspondance, entrée inoffensive) plutôt que de la retirer sans le
// signaler ; "France Info", RÉELLEMENT dans le catalogue mais absente de la
// liste de couleurs donnée, tombe sur "Défaut → bleu" comme prévu par la
// demande pour tout média non listé.
const FRANCE_SOURCE_COLORS = {
  'BFM TV': 'rgba(239,68,68,0.8)',
  'Le Monde': 'rgba(148,163,184,0.7)',
  'Le Figaro': 'rgba(37,99,235,0.85)',
  "L'Obs": 'rgba(168,85,247,0.75)',
  'Libération': 'rgba(220,38,38,0.75)',
};
const FRANCE_SOURCE_COLOR_DEFAULT = 'rgba(37,99,235,0.7)';
function franceSourceColor(label) {
  return FRANCE_SOURCE_COLORS[label] || FRANCE_SOURCE_COLOR_DEFAULT;
}

// Idempotent, même principe que gamingUpdateHeader/techUpdateHeader.
function franceUpdateHeader(container) {
  const card = container.closest('.module-card');
  const header = card?.querySelector('.module-header');
  if (!header) return;
  header.classList.add('france-header');

  const iconEl = header.querySelector('.module-icon');
  if (iconEl && !iconEl.dataset.franceIcon) {
    iconEl.innerHTML = FRANCE_FLAG_SVG;
    iconEl.dataset.franceIcon = '1';
  }

  if (!header.querySelector('.france-header-line')) {
    header.insertAdjacentHTML('beforeend', '<div class="france-header-line"></div>');
  }

  const badge = header.querySelector('.module-badge');
  if (badge && !badge.querySelector('.france-badge-dot')) {
    badge.classList.add('france-news-badge');
    badge.insertAdjacentHTML('afterbegin', '<span class="france-badge-dot"></span>');
  }
}

// Titre 2 lignes max, pas d'extrait (demandé explicitement) — `item.
// description` (disponible depuis l'extraction du 2026-09-22 pour Tech) n'est
// donc JAMAIS lue ici, volontairement : rien à "supprimer" dans CE gabarit,
// il n'a jamais existé pour France (seul Tech affiche un extrait). Chevron
// décoratif (`›`), même esprit que Tech (`.tech-news-item` a le sien posé en
// CSS) — ici en HTML directement, plus simple pour l'aligner avec la colonne
// date/heure au-dessus.
function franceNewsItemHtml(item, catalog) {
  const label = sourcesRssLabel(catalog, item.sourceUrl);
  return `
    <div class="france-news-item" data-link="${item.link}">
      <div class="france-news-main">
        <span class="france-news-source" style="color:${franceSourceColor(label)}">${label}</span>
        <div class="france-news-title">${item.title}</div>
      </div>
      <div class="france-news-side">
        <span class="france-news-time">${rssRelativeTime(item.pubDate)}</span>
        <span class="france-news-chevron">›</span>
      </div>
    </div>`;
}

window.MatinModules.france = {
  async render(container, config, _google, setBadge) {
    setBadge('news');
    franceUpdateHeader(container);

    const catalog = window.FRANCE_NEWS_SOURCES;
    const enabledUrls = Array.isArray(config?.sources) && config.sources.length
      ? config.sources
      : (window.FRANCE_DEFAULT_SOURCES || []);

    // `.sports-module`/`.sports-ticker-vwrap`/`.sports-ticker-vtrack` —
    // INCHANGÉES, demandé littéralement ("même formule que les autres
    // modules RSS ... classes .sports-ticker-v*") : boucle/hauteur flexible
    // gérées par le CSS générique déjà en place, seul le contenu d'un item
    // (`.france-news-item`, nouveau) change.
    container.innerHTML = `
      <div class="sports-module">
        <div class="sports-ticker-vwrap" id="rss-ticker-france">
          <div class="sports-ticker-vtrack">
            <span class="module-empty">Chargement…</span>
          </div>
        </div>
      </div>`;
    const tickerSlot = container.querySelector('#rss-ticker-france');

    try {
      const items = await sourcesRssFetchInterleaved('france', enabledUrls, 4);

      if (!items.length) {
        tickerSlot.innerHTML = RSS_NO_RECENT_ARTICLES_HTML;
        return;
      }

      const itemsHtml = items.map(item => franceNewsItemHtml(item, catalog)).join('');
      const track = document.createElement('div');
      track.className = 'sports-ticker-vtrack';
      track.innerHTML = itemsHtml + itemsHtml; // dupliqué : boucle continue sans à-coup, même mécanisme que les autres tickers
      track.style.animationDuration = `${Math.max(items.length * RSS_TICKER_SEC_PER_ITEM, RSS_TICKER_MIN_SEC)}s`;

      tickerSlot.innerHTML = '';
      tickerSlot.appendChild(track);

      tickerSlot.querySelectorAll('.france-news-item').forEach(el => {
        el.addEventListener('click', () => {
          const link = el.dataset.link;
          if (link) window.matin.shell.openExternal(link);
        });
      });
    } catch (err) {
      tickerSlot.innerHTML = `<span class="module-error">Flux indisponible</span>`;
      console.error('[france]', err);
    }
  },
};
// ─── Tech — habillage visuel dédié "circuit board" (2026-09-22, sur demande
// explicite, palette de tokens + maquette photo fournies) ──────────────────
// PÉRIMÈTRE STRICT respecté à la lettre : réutilise TEL QUEL rssFetchItems/
// rssFilterRecent/sourcesRssInterleave/sourcesRssLabel/rssRelativeTime/
// sourcesRssFetchInterleaved (mêmes sources cochables, même filtre 12h,
// même round-robin par quota que France/Bourse/Gaming) — RIEN de tout ça
// n'est modifié pour eux, ils continuent de passer par
// renderSourcesRssModule, INCHANGÉE. Rendu 100% propre à Tech ci-dessous
// plutôt qu'un enrichissement après coup façon gamingUpdateHeader : la
// maquette demande un EXTRAIT sous le titre, une donnée que
// renderSourcesRssModule n'expose jamais dans le DOM qu'elle produit (elle
// n'affiche QUE item.title) — impossible à récupérer après coup comme la
// pastille purement décorative de Gaming. Item liste STATIQUE (pas le
// ticker défilant `.sports-ticker-v*` des autres modules Actus) : la
// maquette fournie n'en montre pas, défilement interne classique via
// `.module-content { overflow-y: auto }` (générique, voir style.css) à la
// place.
const TECH_MONITOR_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="2.5" y="3.5" width="19" height="13" rx="1.5" stroke="rgba(0,170,255,0.9)" stroke-width="1.4"/>
  <path d="M8 20h8M12 16.5v3.5" stroke="rgba(0,170,255,0.9)" stroke-width="1.4" stroke-linecap="round"/>
  <path d="M5.5 6.5h7M5.5 9h5" stroke="rgba(0,229,200,0.85)" stroke-width="1.2" stroke-linecap="round"/>
  <circle cx="16.5" cy="12" r="1.1" fill="rgba(0,229,200,0.9)"/>
</svg>`;
const TECH_SOURCE_ICON_SVG = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="1" y="1" width="14" height="14" rx="4" fill="rgba(0,170,255,0.12)" stroke="rgba(0,170,255,0.5)" stroke-width="1"/><circle cx="8" cy="8" r="2.2" fill="rgba(0,170,255,0.85)"/></svg>`;
const TECH_CLOCK_ICON_SVG = `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.2"/><path d="M8 4.5V8l2.6 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// Nettoie une `description` RSS brute (peut contenir du HTML/des entités
// selon les flux — jamais injectée telle quelle, voir techNewsItemHtml plus
// bas) avant affichage : passe par un `<template>` pour n'en garder que le
// texte, espaces multiples réduits à 1 seul, tronquée à 160 caractères (la
// maquette n'affiche que 2 lignes via `-webkit-line-clamp`, inutile de
// garder un texte plus long en mémoire/DOM).
function techExcerptFromDescription(raw) {
  if (!raw) return '';
  const tpl = document.createElement('template');
  tpl.innerHTML = raw;
  const text = (tpl.content.textContent || '').replace(/\s+/g, ' ').trim();
  return text.length > 160 ? `${text.slice(0, 160).trimEnd()}…` : text;
}

// Idempotent — `render()` est rappelé à chaque refresh (15 min, voir
// dashboard.js MODULE_REGISTRY.tech.refreshMs), même précaution que
// gamingUpdateHeader (voir plus haut) : le DOM d'en-tête ne doit jamais être
// reconstruit/dupliqué entre 2 appels.
function techUpdateHeader(container) {
  const card = container.closest('.module-card');
  const header = card?.querySelector('.module-header');
  if (!header) return;
  header.classList.add('tech-header');

  let group = header.querySelector('.module-title-group');
  const titleEl = header.querySelector('.module-title');
  if (!group && titleEl) {
    group = document.createElement('div');
    group.className = 'module-title-group';
    titleEl.replaceWith(group);
    group.appendChild(titleEl);
  }

  // Icône sortie de `.module-title` (même déplacement que Gaming/Mon
  // Équipe/LIVE FOOT! avant elle) — carré dédié à gauche du bloc titre,
  // remplace l'emoji 💻 générique par le SVG moniteur de la maquette.
  const iconEl = header.querySelector('.module-icon');
  if (iconEl) {
    if (!iconEl.dataset.techIcon) {
      iconEl.innerHTML = TECH_MONITOR_ICON_SVG;
      iconEl.dataset.techIcon = '1';
    }
    if (group && iconEl.parentElement === titleEl) header.insertBefore(iconEl, group);
  }

  // Séparateur vertical entre icône et bloc titre (élément réel, comme
  // .header-glow-line pour Gaming — plus simple à positionner qu'un
  // pseudo-élément partagé avec la grille/le glow du header, qui occupent
  // déjà ::before/::after).
  if (iconEl && !header.querySelector('.tech-header-divider')) {
    const divider = document.createElement('div');
    divider.className = 'tech-header-divider';
    header.insertBefore(divider, iconEl.nextSibling);
  }

  // Sous-titre "Actus & infos" RETIRÉ (2026-09-24, sur demande explicite,
  // v3) — `.module-title-group` reste en place malgré tout (même s'il ne
  // contient plus qu'un seul enfant) : le retirer casserait l'agencement du
  // header (icône/séparateur/groupe) posé par le reste de cette fonction,
  // pour un gain nul, `.module-title-group { display:flex; flex-direction:
  // column }` ne changeant rien à l'affichage avec un seul enfant.

  // Trait néon bas + coins décoratifs (éléments réels, voir commentaire
  // séparateur ci-dessus — même raison).
  if (!header.querySelector('.tech-header-line')) {
    header.insertAdjacentHTML('beforeend', '<div class="tech-header-line"></div>');
  }
  if (!header.querySelector('.tech-corner-tl')) {
    header.insertAdjacentHTML('beforeend', `
      <span class="tech-corner tech-corner-tl"></span>
      <span class="tech-corner tech-corner-tr"></span>
      <span class="tech-corner tech-corner-bl"></span>
      <span class="tech-corner tech-corner-br"></span>
    `);
  }

  const badge = header.querySelector('.module-badge');
  if (badge && !badge.querySelector('.tech-badge-dot')) {
    badge.classList.add('tech-news-badge');
    badge.insertAdjacentHTML('afterbegin', '<span class="tech-badge-dot"></span>');
  }
}

function techNewsItemHtml(item, catalog) {
  return `
    <div class="tech-news-item" data-link="${item.link}">
      <div class="tech-news-meta">
        <span class="tech-news-source">${TECH_SOURCE_ICON_SVG}${sourcesRssLabel(catalog, item.sourceUrl)}</span>
        <span class="tech-news-time">${TECH_CLOCK_ICON_SVG}${rssRelativeTime(item.pubDate)}</span>
      </div>
      <div class="tech-news-title">${item.title}</div>
      <div class="tech-news-excerpt">${techExcerptFromDescription(item.description)}</div>
    </div>`;
}

window.MatinModules.tech = {
  async render(container, config, _google, setBadge) {
    setBadge('news');
    techUpdateHeader(container);

    const catalog = window.TECH_NEWS_SOURCES;
    const defaults = window.TECH_DEFAULT_SOURCES;
    const quota = 4;
    const enabledUrls = Array.isArray(config?.sources) && config.sources.length
      ? config.sources
      : (defaults || []);

    // Défilement automatique en boucle, pause au survol (2026-09-24, v3 —
    // REMPLACE la liste statique/scrollable de la v2) — durée calculée
    // dynamiquement comme Gaming (même formule RSS_TICKER_SEC_PER_ITEM,
    // min RSS_TICKER_MIN_SEC) depuis la v5 (2026-09-23, sur demande) —
    // contenu dupliqué ×2 côté JS pour la boucle seamless, classes DÉDIÉES
    // (pas .sports-ticker-v*) pour garder la mise en forme riche
    // (meta/extrait/chevron), absente de ces classes génériques.
    container.innerHTML = `<div class="tech-news-wrap" id="tech-news-wrap"><span class="module-empty">Chargement…</span></div>`;
    const wrap = container.querySelector('#tech-news-wrap');

    try {
      const items = await sourcesRssFetchInterleaved('tech', enabledUrls, quota);

      if (!items.length) {
        wrap.innerHTML = RSS_NO_RECENT_ARTICLES_HTML;
        return;
      }

      const itemsHtml = items.map(item => techNewsItemHtml(item, catalog)).join('');
      const track = document.createElement('div');
      track.className = 'tech-news-track';
      track.innerHTML = itemsHtml + itemsHtml; // dupliqué : boucle continue sans à-coup, voir @keyframes tech-news-scroll
      track.style.animationDuration = `${Math.max(items.length * RSS_TICKER_SEC_PER_ITEM, RSS_TICKER_MIN_SEC)}s`;

      wrap.innerHTML = '';
      wrap.appendChild(track);

      wrap.querySelectorAll('.tech-news-item').forEach(el => {
        el.addEventListener('click', () => {
          const link = el.dataset.link;
          if (link) window.matin.shell.openExternal(link);
        });
      });
    } catch (err) {
      wrap.innerHTML = `<span class="module-error">Flux indisponible</span>`;
      console.error('[tech]', err);
    }
  },
};
// ─── Bourse — habillage visuel dédié "vert forêt" (2026-09-23, sur demande
// explicite, maquette fournie) ──────────────────────────────────────────────
// PÉRIMÈTRE STRICT : réutilise TEL QUEL sourcesRssFetchInterleaved/
// rssFilterRecent/sourcesRssLabel/rssRelativeTime — mêmes sources cochables,
// même filtre 12h, même round-robin par quota que France/Tech/Gaming, RIEN
// de tout ça n'est modifié. Rendu 100% propre à Bourse (comme Tech
// ci-dessus), nécessaire pour 2 raisons que renderSourcesRssModule ne permet
// pas : (1) une classe CSS PAR SOURCE pour les 3 couleurs demandées — elle
// ne pose qu'une seule classe générique `.sports-ticker-source` pour toutes
// les sources ; (2) coloration des variations de cours DANS le titre — elle
// injecte `item.title` tel quel, sans jamais le retraiter.
//
// Écart signalé avant implémentation (voir conversation) : les 5 sources
// demandées pour la coloration ("Les Echos", "BFM Bourse", "Reuters",
// "Investir", "Capitalcom") ne correspondent à AUCUNE source réelle du
// catalogue (`window.BOURSE_NEWS_SOURCES`, voir bourse-sources.js) — Les
// Échos y est explicitement documentée comme ABANDONNÉE (403 bloqué,
// vérifié en direct), les 4 autres n'y ont jamais existé. Appliqué à la
// place aux 3 VRAIES sources actuelles (Challenges Économie/BFM Business/
// Capital), sur décision explicite de l'utilisateur plutôt que d'inventer un
// mapping mort.
// Couleur posée EN INLINE (2026-09-23, sur demande explicite — remplace les
// 3 classes CSS .bourse-source-* utilisées jusqu'ici) directement sur le
// `style` du <span>, voir bourseNewsItemHtml ci-dessous.
const BOURSE_SOURCE_COLORS = {
  'Challenges Économie': 'rgba(34, 197, 94, 0.85)',
  'BFM Business': 'rgba(59, 130, 246, 0.80)',
  'Capital': 'rgba(168, 85, 247, 0.75)',
};
function bourseSourceColor(label) {
  return BOURSE_SOURCE_COLORS[label] || '#22c55e';
}

// Colore les variations de cours détectées DANS le titre (point 6, sur
// demande explicite) — motif "+1,2 %"/"−2,8 %" (tiret court "-" OU signe
// moins typographique U+2212, virgule décimale FR, espace optionnel avant
// "%") entouré d'un span vert (hausse) ou rouge (baisse). `item.title` n'est
// déjà échappé nulle part ailleurs dans ce fichier avant affichage (voir
// .sports-ticker-vitem/.tech-news-title plus haut) — même niveau de
// confiance envers le flux RSS ici, aucune nouvelle surface introduite.
function bourseHighlightVariation(title) {
  return (title || '').replace(/([+\-−]\s?\d+(?:[.,]\d+)?\s?%)/g, (match) => {
    const isDown = /^[-−]/.test(match.trim());
    return `<span class="bourse-variation ${isDown ? 'bourse-variation-down' : 'bourse-variation-up'}">${match}</span>`;
  });
}

function bourseNewsItemHtml(item, catalog) {
  const sourceLabel = sourcesRssLabel(catalog, item.sourceUrl);
  return `
    <div class="bourse-news-item" data-link="${item.link}">
      <div class="bourse-news-meta">
        <span class="bourse-news-source" style="color: ${bourseSourceColor(sourceLabel)}">${sourceLabel}</span>
        <span class="bourse-news-time">${rssRelativeTime(item.pubDate)}</span>
      </div>
      <div class="bourse-news-title">${bourseHighlightVariation(item.title)}</div>
    </div>`;
}

window.MatinModules.bourse = {
  async render(container, config, _google, setBadge) {
    setBadge('news');
    const catalog = window.BOURSE_NEWS_SOURCES;
    const defaults = window.BOURSE_DEFAULT_SOURCES;
    const quota = 4;
    const enabledUrls = Array.isArray(config?.sources) && config.sources.length
      ? config.sources
      : (defaults || []);

    // Défilement automatique en boucle, pause au survol — même technique que
    // Tech/Gaming (contenu dupliqué ×2 côté JS pour la boucle seamless,
    // durée calculée dynamiquement via RSS_TICKER_SEC_PER_ITEM/
    // RSS_TICKER_MIN_SEC, point 5 de la demande).
    container.innerHTML = `<div class="bourse-news-wrap" id="bourse-news-wrap"><span class="module-empty">Chargement…</span></div>`;
    const wrap = container.querySelector('#bourse-news-wrap');

    try {
      const items = await sourcesRssFetchInterleaved('bourse', enabledUrls, quota);

      if (!items.length) {
        wrap.innerHTML = RSS_NO_RECENT_ARTICLES_HTML;
        return;
      }

      const itemsHtml = items.map(item => bourseNewsItemHtml(item, catalog)).join('');
      const track = document.createElement('div');
      track.className = 'bourse-news-track';
      track.innerHTML = itemsHtml + itemsHtml; // dupliqué : boucle continue sans à-coup, voir @keyframes bourse-news-scroll
      track.style.animationDuration = `${Math.max(items.length * RSS_TICKER_SEC_PER_ITEM, RSS_TICKER_MIN_SEC)}s`;

      wrap.innerHTML = '';
      wrap.appendChild(track);

      wrap.querySelectorAll('.bourse-news-item').forEach(el => {
        el.addEventListener('click', () => {
          const link = el.dataset.link;
          if (link) window.matin.shell.openExternal(link);
        });
      });
    } catch (err) {
      wrap.innerHTML = `<span class="module-error">Flux indisponible</span>`;
      console.error('[bourse]', err);
    }
  },
};
// ─── Gaming — habillage visuel dédié (2026-09-23, sur demande explicite,
// refonte "néon" fournie avec palette de tokens précise) ────────────────────
// PÉRIMÈTRE STRICT respecté à la lettre : `renderSourcesRssModule` ci-dessus
// (fetch RSS, cache implicite via Promise.allSettled, interleave, filtre 12h,
// gestion de `config.sources`) N'EST PAS TOUCHÉE — elle reste PARTAGÉE avec
// France/Tech/Bourse, qui doivent garder leur apparence actuelle inchangée.
// Gaming l'appelle telle quelle, puis ENRICHIT le DOM déjà posé dans
// `container` (en-tête de carte + une pastille miniature décorative par
// article) — jamais avant, jamais en paralèle : la fonction partagée doit
// avoir fini d'écrire son HTML avant qu'on cherche `.sports-ticker-vitem`.
// Aucune donnée n'est ajoutée ou lue en plus (la pastille est un simple
// dégradé CSS, pas une vraie vignette d'article — le flux RSS parsé par
// `rssFetchItems` n'extrait que titre/lien/date, jamais d'image).
const GAMING_CONTROLLER_SVG = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M14 18h20a8 8 0 0 1 8 9.5l-1.2 6A5 5 0 0 1 36 38a5 5 0 0 1-4-2l-3-4H19l-3 4a5 5 0 0 1-4 2 5 5 0 0 1-4.8-4.5l-1.2-6A8 8 0 0 1 14 18z"
    stroke="rgba(0,200,255,0.85)" stroke-width="2" stroke-linejoin="round"/>
  <path d="M15 24v6M12 27h6" stroke="rgba(0,200,255,0.85)" stroke-width="2" stroke-linecap="round"/>
  <circle cx="33" cy="24" r="1.6" fill="rgba(0,200,255,0.85)"/>
  <circle cx="29" cy="28" r="1.6" fill="rgba(224,64,251,0.9)"/>
  <circle cx="37" cy="28" r="1.6" fill="rgba(0,200,255,0.85)"/>
  <circle cx="33" cy="32" r="1.6" fill="rgba(0,200,255,0.85)"/>
</svg>`;
const GAMING_STAR_SVG = `<svg viewBox="0 0 24 24" fill="rgba(224,64,251,1)" xmlns="http://www.w3.org/2000/svg"><path d="M12 2.5l2.9 6.4 6.9.7-5.2 4.7 1.5 6.8-6.1-3.6-6.1 3.6 1.5-6.8-5.2-4.7 6.9-.7z"/></svg>`;

// Idempotent — `render()` est rappelé à chaque refresh (15 min, voir
// dashboard.js MODULE_REGISTRY.gaming.refreshMs), le DOM d'en-tête (posé sur
// le card générique, PAS `container`, qui n'est que `.module-content`) ne
// doit jamais être reconstruit/dupliqué entre 2 appels.
function gamingUpdateHeader(container) {
  const card = container.closest('.module-card');
  const header = card?.querySelector('.module-header');
  if (!header) return;
  header.classList.add('gaming-header');

  if (!header.querySelector('.header-glow-line')) {
    const line = document.createElement('div');
    line.className = 'header-glow-line';
    header.appendChild(line);
  }

  // Pas de sous-titre enregistré pour ce module (voir dashboard.js
  // resolveModuleSubtitle — Gaming n'y figure pas) : `.module-title-group`
  // n'existe donc pas par défaut, contrairement à Prêts/LIVE FOOT!/Mon
  // Équipe. Construit ici une seule fois, à l'identique du mécanisme
  // générique (createModuleCard), pour rester compatible avec les règles
  // CSS génériques `.module-title-group`/`.module-subtitle` déjà en place.
  let group = header.querySelector('.module-title-group');
  const titleEl = header.querySelector('.module-title');
  if (!group && titleEl) {
    group = document.createElement('div');
    group.className = 'module-title-group';
    titleEl.replaceWith(group);
    group.appendChild(titleEl);
  }

  // Icône sortie de `.module-title` (2026-09-23) — la maquette la veut en
  // carré 48×48 à gauche du bloc titre/sous-titre, pas alignée sur la ligne
  // de base du texte comme l'icône générique (14px, inline dans le titre) :
  // même déplacement que Mon Équipe/LIVE FOOT! avant elle (voir
  // monEquipeUpdateHeader/liveUpdateHeader), devenue enfant direct de
  // `.module-header`, juste avant le groupe titre.
  const iconEl = header.querySelector('.module-icon');
  if (iconEl) {
    if (!iconEl.dataset.gamingIcon) {
      iconEl.innerHTML = GAMING_CONTROLLER_SVG;
      iconEl.dataset.gamingIcon = '1';
    }
    if (group && iconEl.parentElement === titleEl) header.insertBefore(iconEl, group);
  }
  // Sous-titre "Actus & infos" RETIRÉ (2026-09-24, sur demande explicite,
  // v3) — `group` reste en place (voir commentaire équivalent dans
  // techUpdateHeader plus bas).

  const badge = header.querySelector('.module-badge');
  if (badge && !badge.querySelector('.gaming-badge-star')) {
    badge.classList.add('gaming-news-badge');
    badge.insertAdjacentHTML('afterbegin', `<span class="gaming-badge-star">${GAMING_STAR_SVG}</span>`);
  }
}

window.MatinModules.gaming = {
  async render(container, config, _google, setBadge) {
    await renderSourcesRssModule('gaming', container, config, setBadge, {
      catalog: window.GAMING_NEWS_SOURCES, defaults: window.GAMING_DEFAULT_SOURCES, quota: 4,
    });
    // APRÈS le await, jamais avant (2026-09-23, piège réel rencontré) :
    // `renderSourcesRssModule` appelle `setBadge('news')` en tout début
    // d'exécution, et `setBadge` (voir dashboard.js renderModuleOnce) fait
    // `el.textContent = badge` — un simple texte qui EFFACE tout enfant déjà
    // présent. Décorer le badge (étoile) AVANT cet appel l'aurait fait
    // disparaître aussitôt ; l'appeler après le await est le seul ordre sûr,
    // `renderSourcesRssModule` n'appelant plus jamais `setBadge` ensuite dans
    // ce cycle de rendu.
    gamingUpdateHeader(container);
    // Pastille décorative par article RETIRÉE (2026-09-24, sur demande
    // explicite, v3 — "les 4 cadres vides retirés des articles") : cette
    // fonction n'insère plus `.gaming-thumb`.
  },
};
// ─── Module : Sciences — refonte visuelle (2026-09-23, sur demande
// explicite, capture fournie) ────────────────────────────────────────────
// PÉRIMÈTRE STRICT, même précédent que Tech/Gaming ci-dessus : rendu DÉDIÉ
// plutôt que de modifier `makeRssModule` (PARTAGÉE avec Santé/SportNews, qui
// gardent leur apparence actuelle INCHANGÉE) — réutilise seulement
// RSS_FEED_DEFS.science/rssFetchItems/rssFilterRecent (mêmes 3 sources
// fixes, même filtre 12h, même tri chronologique + troncature à 12), jamais
// `makeRssModule` elle-même. Ticker : mêmes classes `.sports-ticker-v*` +
// même formule RSS_TICKER_SEC_PER_ITEM/RSS_TICKER_MIN_SEC que les autres
// modules RSS (déjà le cas via `makeRssModule` avant cette refonte, INCHANGÉ
// ici) — `.sports-ticker-vwrap` a déjà `flex:1;min-height:0` (règle
// générique plus haut dans ce fichier), donc déjà "hauteur flexible".
const SCIENCE_ATOM_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="2.2" fill="currentColor"/>
  <ellipse cx="12" cy="12" rx="9" ry="3.6" stroke="currentColor" stroke-width="1.3" opacity="0.9"/>
  <ellipse cx="12" cy="12" rx="9" ry="3.6" stroke="currentColor" stroke-width="1.3" opacity="0.6" transform="rotate(60 12 12)"/>
  <ellipse cx="12" cy="12" rx="9" ry="3.6" stroke="currentColor" stroke-width="1.3" opacity="0.6" transform="rotate(120 12 12)"/>
</svg>`;
const SCIENCE_CHEVRON_SVG = '<svg viewBox="0 0 8 14" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 1.5L6.5 7L1.5 12.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// Classification VISUELLE par mot-clé sur le TITRE déjà récupéré (2026-09-23,
// sur demande explicite) — aucune nouvelle source/logique de fetch : ce
// module n'a aucune vraie donnée de catégorie côté flux RSS (`rssFetchItems`
// n'extrait ni ne lit de `<category>`), un mot-clé sur le titre est la seule
// façon d'obtenir la coloration par thème demandée. "Physique" (dernier
// repli, tout titre ne matchant aucun mot-clé) partage la couleur teal
// d'IA & Technologie, comme demandé explicitement ("Physique / défaut →
// teal") — même classe CSS `science-cat-ia` réutilisée pour les 2.
const SCIENCE_CATEGORIES = [
  { label: 'IA & Technologie', cls: 'science-cat-ia', re: /\b(ia|intelligence artificielle|algorithmes?|robots?|robotique|technologie|numérique|informatique)\b/i },
  { label: 'Espace', cls: 'science-cat-espace', re: /\b(espace|satellites?|fusées?|orbite|nasa|spacex|lune|mars)\b/i },
  { label: 'Astronomie', cls: 'science-cat-astro', re: /\b(exoplanètes?|étoiles?|galaxies?|télescopes?|astronomie|univers|planètes?|cosmos)\b/i },
  { label: 'Santé', cls: 'science-cat-sante', re: /\b(santé|maladies?|traitements?|médecins?|alzheimer|cancers?|vaccins?|virus)\b/i },
];
const SCIENCE_DEFAULT_CATEGORY = { label: 'Physique', cls: 'science-cat-ia' };

function scienceDetectCategory(title) {
  return SCIENCE_CATEGORIES.find(c => c.re.test(title || '')) || SCIENCE_DEFAULT_CATEGORY;
}

// Idempotent — render() rappelé à chaque refresh (15 min, voir dashboard.js
// MODULE_REGISTRY.science.refreshMs), même précaution que gamingUpdateHeader/
// techUpdateHeader ci-dessus : le DOM d'en-tête ne doit jamais être
// reconstruit/dupliqué entre 2 appels.
function scienceUpdateHeader(container) {
  const card = container.closest('.module-card');
  const header = card?.querySelector('.module-header');
  if (!header) return;
  header.classList.add('science-header');

  // Icône atome (2026-09-23, sur demande explicite, "garde l'icône atome")
  // — remplace l'emoji 🔬 générique (MODULE_REGISTRY.science, dashboard.js)
  // par ce SVG, inline dans `.module-title` (position/taille INCHANGÉES,
  // contrairement à Tech/Gaming qui sortent et agrandissent leur icône —
  // rien de tel demandé ici).
  const iconEl = header.querySelector('.module-icon');
  if (iconEl && !iconEl.dataset.scienceIcon) {
    iconEl.innerHTML = SCIENCE_ATOM_ICON_SVG;
    iconEl.dataset.scienceIcon = '1';
  }

  // Sous-titre "Découvertes & Innovations" — supprimé s'il existe (2026-09-23,
  // sur demande explicite). Sciences n'a jamais eu de sous-titre enregistré
  // (voir dashboard.js resolveModuleSubtitle, qui ne couvre pas ce module) :
  // ce garde-fou ne trouve donc rien à retirer en pratique aujourd'hui,
  // gardé si un sous-titre venait à être ajouté plus tard.
  header.querySelector('.module-subtitle')?.remove();

  // Badge "NEWS" (2026-09-23, sur demande explicite, "garde... le badge
  // NEWS") — pastille + couleur, même mécanisme que gaming-badge-star.
  const badge = header.querySelector('.module-badge');
  if (badge && !badge.querySelector('.science-badge-dot')) {
    badge.classList.add('science-news-badge');
    badge.insertAdjacentHTML('afterbegin', '<span class="science-badge-dot"></span>');
  }
}

function scienceNewsItemHtml(item) {
  const category = scienceDetectCategory(item.title);
  return `
    <div class="sports-ticker-vitem science-news-item" data-link="${item.link}">
      <div class="science-news-main">
        <span class="sports-ticker-source science-news-category ${category.cls}">${category.label}</span>
        <span class="science-news-title">${item.title}</span>
      </div>
      <div class="science-news-meta">
        <span class="science-news-date">${rssRelativeTime(item.pubDate)}</span>
        <span class="science-news-chev">${SCIENCE_CHEVRON_SVG}</span>
      </div>
    </div>`;
}

window.MatinModules.science = {
  async render(container, _config, _google, setBadge) {
    const feed = RSS_FEED_DEFS.science;
    setBadge('news');
    scienceUpdateHeader(container);

    container.innerHTML = `
      <div class="sports-module">
        <div class="sports-ticker-vwrap" id="rss-ticker-science">
          <div class="sports-ticker-vtrack">
            <div class="sports-ticker-vitem">Chargement…</div>
          </div>
        </div>
      </div>`;
    const tickerSlot = container.querySelector('#rss-ticker-science');

    try {
      // Fetch/tri/troncature/filtre IDENTIQUES à makeRssModule pour ce même
      // feedKey (voir plus haut) — dupliqués ici plutôt qu'appelés via elle,
      // puisqu'elle écrit directement son propre HTML sans renvoyer les
      // items à l'appelant (même raison que sourcesRssFetchInterleaved a été
      // extraite séparément pour Tech).
      const results = await Promise.allSettled(feed.sources.map(url => rssFetchItems(url, 8)));
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.warn(`[science] Source indisponible: ${feed.sources[i]}`, r.reason?.message);
      });
      let items = results.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
      items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
      items = items.slice(0, 12);
      items = rssFilterRecent(items);

      if (!items.length) {
        tickerSlot.innerHTML = RSS_NO_RECENT_ARTICLES_HTML;
        return;
      }

      const itemsHtml = items.map(scienceNewsItemHtml).join('');
      const track = document.createElement('div');
      track.className = 'sports-ticker-vtrack';
      track.innerHTML = itemsHtml + itemsHtml; // dupliqué : boucle continue sans à-coup (voir @keyframes sports-ticker-v)
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
      console.error('[science]', err);
    }
  },
};
// ─── Santé — habillage visuel dédié "rosé" (2026-09-24, sur demande
// explicite) ─────────────────────────────────────────────────────────────
// PÉRIMÈTRE STRICT : réutilise TEL QUEL rssFetchItems/rssFilterRecent/
// RSS_FEED_DEFS.sante.sources (mêmes 2 sources fixes, même filtre 12h, même
// tri chronologique + troncature à 12 que l'ancien makeRssModule('sante'),
// entièrement REMPLACÉ ici — plus aucun autre appelant, supprimé).
//
// Écart signalé avant implémentation (voir conversation) : les 5 sources
// demandées pour la coloration ("Pourquoi Docteur", "Le Monde Santé",
// "BFM TV Santé", "Destination Santé", "Santé Magazine") ne correspondent à
// AUCUNE source réelle du catalogue (`RSS_FEED_DEFS.sante.sources`, voir
// plus haut) — Pourquoi Docteur y est explicitement documentée comme
// ABANDONNÉE (410 Gone, aucune autodiscovery trouvée), les 4 autres n'y ont
// jamais existé. Appliqué à la place aux 2 VRAIES sources actuelles
// (Doctissimo/Le Quotidien du Médecin), sur décision explicite de
// l'utilisateur — Doctissimo reprend la couleur rose du slot "Pourquoi
// Docteur" (même esprit, site d'info santé grand public), Le Quotidien du
// Médecin reprend le gris-bleu du slot "Le Monde Santé" (média d'actualité
// généraliste/professionnel).
//
// Ce module N'AFFICHAIT AUCUN nom de source par article jusqu'ici (juste une
// heure relative, voir l'ancien makeRssModule ci-dessus) — chaque item est
// désormais tagué avec son `sourceUrl` (même technique que
// sourcesRssFetchInterleaved plus haut) pour permettre ce nouvel affichage.
const SANTE_SOURCE_LABELS = {
  'https://www.doctissimo.fr/feed': 'Doctissimo',
  'https://www.lequotidiendumedecin.fr/rss.xml': 'Le Quotidien du Médecin',
};
const SANTE_SOURCE_COLORS = {
  'Doctissimo': 'rgba(244, 114, 182, 0.85)',
  'Le Quotidien du Médecin': 'rgba(148, 163, 184, 0.75)',
};
function santeSourceLabel(url) {
  return SANTE_SOURCE_LABELS[url] || url;
}
function santeSourceColor(label) {
  return SANTE_SOURCE_COLORS[label] || '#f472b6';
}

function santeNewsItemHtml(item) {
  const label = santeSourceLabel(item.sourceUrl);
  return `
    <div class="sante-news-item" data-link="${item.link}">
      <div class="sante-news-meta">
        <span class="sante-news-source" style="color: ${santeSourceColor(label)}">${label}</span>
        <span class="sante-news-time">${rssRelativeTime(item.pubDate)}</span>
      </div>
      <div class="sante-news-title">${item.title}</div>
    </div>`;
}

// Insère la ligne lumineuse en bas du header (point 4 de la demande, glow
// line) — élément réel, comme .tech-header-line — idempotent : `render()`
// est rappelé à chaque refresh (15 min, voir dashboard.js
// MODULE_REGISTRY.sante.refreshMs), ne doit jamais être dupliqué entre 2
// appels.
function santeUpdateHeader(container) {
  const card = container.closest('.module-card');
  const header = card?.querySelector('.module-header');
  if (!header) return;
  if (!header.querySelector('.sante-header-line')) {
    header.insertAdjacentHTML('beforeend', '<div class="sante-header-line"></div>');
  }
}

window.MatinModules.sante = {
  async render(container, _config, _google, setBadge) {
    setBadge('news');
    santeUpdateHeader(container);
    // Défilement automatique en boucle, pause au survol — même technique que
    // Bourse/Tech (contenu dupliqué ×2 côté JS, durée calculée dynamiquement
    // via RSS_TICKER_SEC_PER_ITEM/RSS_TICKER_MIN_SEC, point 6 de la demande —
    // déjà la formule utilisée par l'ancien makeRssModule, INCHANGÉE).
    container.innerHTML = `<div class="sante-news-wrap" id="sante-news-wrap"><span class="module-empty">Chargement…</span></div>`;
    const wrap = container.querySelector('#sante-news-wrap');
    const sources = RSS_FEED_DEFS.sante.sources;

    try {
      const results = await Promise.allSettled(sources.map(url => rssFetchItems(url, 8)));
      let items = [];
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          console.warn(`[sante] Source indisponible: ${sources[i]}`, r.reason?.message);
          return;
        }
        items.push(...r.value.map(item => ({ ...item, sourceUrl: sources[i] })));
      });
      items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
      items = rssFilterRecent(items).slice(0, 12);

      if (!items.length) {
        wrap.innerHTML = RSS_NO_RECENT_ARTICLES_HTML;
        return;
      }

      const itemsHtml = items.map(santeNewsItemHtml).join('');
      const track = document.createElement('div');
      track.className = 'sante-news-track';
      track.innerHTML = itemsHtml + itemsHtml; // dupliqué : boucle continue sans à-coup, voir @keyframes sante-news-scroll
      track.style.animationDuration = `${Math.max(items.length * RSS_TICKER_SEC_PER_ITEM, RSS_TICKER_MIN_SEC)}s`;

      wrap.innerHTML = '';
      wrap.appendChild(track);

      wrap.querySelectorAll('.sante-news-item').forEach(el => {
        el.addEventListener('click', () => {
          const link = el.dataset.link;
          if (link) window.matin.shell.openExternal(link);
        });
      });
    } catch (err) {
      wrap.innerHTML = `<span class="module-error">Flux indisponible</span>`;
      console.error('[sante]', err);
    }
  },
};

// ─── Module : Actus Sportives (sportNews) — habillage visuel dédié
// (2026-09-24, sur demande explicite) ────────────────────────────────────
// PÉRIMÈTRE : réutilise TEL QUEL rssFetchItems/rssFilterRecent (mêmes 2
// sources FIXES, RSS_FEED_DEFS.sportNews.sources, même filtre 12h) — plus
// via l'ancienne `makeRssModule` (depuis supprimée, voir plus haut, Santé
// étant devenue son dernier appelant) : remplacée ici par un rendu DÉDIÉ,
// nécessaire pour afficher le VRAI nom de la source, chacun avec sa propre
// couleur — `makeRssModule` affichait une heure relative à la place de la
// source, incompatible avec la demande.
const SPORTNEWS_SOURCE_LABELS = {
  'https://rmcsport.bfmtv.com/rss/football/': 'RMC Sport',
  'https://dwh.lequipe.fr/api/edito/rss?path=/Football': "L'Équipe",
};

// Couleur du libellé de source (2026-09-24, sur demande explicite, valeurs
// données une par une) — clé = LIBELLÉ affiché (voir SPORTNEWS_SOURCE_LABELS
// ci-dessus), même mécanisme que FRANCE_SOURCE_COLORS/franceSourceColor
// (couleur posée en `style` inline). Écart signalé : "Eurosport"/
// "Foot Mercato"/"BeBasket" ne correspondent à AUCUNE des 2 sources FIXES
// réellement configurées ici (RSS_FEED_DEFS.sportNews.sources, seules RMC
// Sport et L'Équipe) — gardées telles quelles (entrées inoffensives, jamais
// de correspondance tant qu'aucune source de ce nom n'est ajoutée), même
// parti pris que "L'Obs" dans FRANCE_SOURCE_COLORS.
const SPORTNEWS_SOURCE_COLORS = {
  "L'Équipe": 'rgba(250,204,21,0.85)',
  'RMC Sport': 'rgba(59,130,246,0.85)',
  'Eurosport': 'rgba(249,115,22,0.85)',
  'Foot Mercato': 'rgba(34,197,94,0.80)',
  'BeBasket': 'rgba(168,85,247,0.80)',
};
function sportNewsSourceColor(label) {
  return SPORTNEWS_SOURCE_COLORS[label] || null;
}

function sportNewsItemHtml(item) {
  const label = SPORTNEWS_SOURCE_LABELS[item.sourceUrl] || '';
  const color = sportNewsSourceColor(label);
  const sourceHtml = label
    ? `<span class="sports-ticker-source"${color ? ` style="color:${color}"` : ''}>${label}</span>`
    : '';
  // Titre dans son PROPRE span (2026-09-24, sur demande explicite — "la 3e
  // ligne d'un titre peut être coupée") — CAUSE RÉELLE : `.sports-ticker-
  // source` de ce module est en `display:block` (sur sa propre ligne
  // au-dessus du titre, voir style.css), et `-webkit-line-clamp` posé
  // directement sur `.sports-ticker-vitem` compte alors CE bloc source comme
  // 1re "ligne" avant même le titre — le comptage de lignes devient peu
  // fiable dès qu'un enfant `display:block` précède du texte dans une boîte
  // `-webkit-line-clamp`, un texte long peut alors déborder sur une 3e ligne
  // qui n'est coupée qu'en aval, par le débordement caché du conteneur du
  // ticker, plutôt que proprement tronquée par une ellipse à 2 lignes. Le
  // clamp est déplacé sur CE span dédié (voir style.css .sportnews-title),
  // qui ne contient QUE le texte du titre — la source reste en dehors,
  // comptage de lignes fiable quelle que soit sa présence.
  return `<div class="sports-ticker-vitem" data-link="${item.link}">${sourceHtml}<span class="sportnews-title">${item.title}</span></div>`;
}

window.MatinModules.sportNews = {
  async render(container, _config, _google, setBadge) {
    const feed = RSS_FEED_DEFS.sportNews;
    setBadge('news');

    // `.sports-module`/`.sports-ticker-vwrap`/`.sports-ticker-vtrack` —
    // INCHANGÉES (mêmes classes que makeRssModule produisait), seul le
    // contenu d'un item change (source réelle + couleur, plus de champ
    // excerpt/thumbnail).
    container.innerHTML = `
      <div class="sports-module">
        <div class="sports-ticker-vwrap" id="rss-ticker-sportNews">
          <div class="sports-ticker-vtrack">
            <div class="sports-ticker-vitem">Chargement…</div>
          </div>
        </div>
      </div>`;
    const tickerSlot = container.querySelector('#rss-ticker-sportNews');

    try {
      // Fetch/tri/troncature/filtre IDENTIQUES à makeRssModule pour ce même
      // feedKey (multi-sources) — seul ajout : `sourceUrl` posé sur chaque
      // item pour retrouver son libellé/sa couleur au rendu.
      const results = await Promise.allSettled(feed.sources.map(url => rssFetchItems(url, 8)));
      results.forEach((r, i) => {
        if (r.status === 'rejected') console.warn(`[sportNews] Source indisponible: ${feed.sources[i]}`, r.reason?.message);
      });
      let items = results.flatMap((r, i) =>
        r.status === 'fulfilled' ? r.value.map(item => ({ ...item, sourceUrl: feed.sources[i] })) : []
      );
      items.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
      items = items.slice(0, 12);
      items = rssFilterRecent(items);

      if (!items.length) {
        tickerSlot.innerHTML = RSS_NO_RECENT_ARTICLES_HTML;
        return;
      }

      const itemsHtml = items.map(sportNewsItemHtml).join('');
      const track = document.createElement('div');
      track.className = 'sports-ticker-vtrack';
      track.innerHTML = itemsHtml + itemsHtml; // dupliqué : boucle continue sans à-coup (voir @keyframes sports-ticker-v, translateY -50%)
      // Même formule que Gaming (2026-09-24, sur demande explicite) — déjà le
      // cas ici : RSS_TICKER_SEC_PER_ITEM/RSS_TICKER_MIN_SEC, aucun changement
      // de comportement, juste confirmé/documenté suite à la demande.
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
      console.error('[sportNews]', err);
    }
  },
};
