/**
 * Module Cinéma — 3 sections (2026-08-05 → 2026-08-10 → 2026-08-11 →
 * 2026-08-15 → 2026-08-15, sur demande explicite à chaque révision) :
 *   1) Actus Cinéma — liste STATIQUE (pas de défilement), 4 titres visibles
 *      d'office, "Voir plus ▼" déplie jusqu'à 10 au total dans un tiroir
 *   2) Films actuellement en salle — TOUS les films encore à l'affiche,
 *      format compact (vignette 40px + titre + genre, sur une ligne), ticker
 *      vertical défilant à hauteur FIXE (exactement 2 films visibles à la
 *      fois, le 3e apparaît en défilant — voir .cinema-nowplaying-vwrap)
 *   3) Sorties de la semaine prochaine — UNIQUEMENT les films du prochain
 *      mercredi de sortie, diaporama : un seul film à la fois (grande
 *      vignette + titre + genre + synopsis), 6s d'affichage puis glissement
 *      rapide (~300ms) vers le suivant, boucle infinie
 * Titre de la carte cliquable → https://www.allocine.fr : déjà géré par le
 * mécanisme générique MODULE_CLICK_URLS de dashboard.js, rien à faire ici.
 *
 * ÉCART ASSUMÉ, reconfirmé le 2026-08-11 (déjà vérifié le 2026-08-10, re-
 * vérifié en direct à cette révision au cas où ça aurait changé) : AUCUN flux
 * RSS AlloCiné n'existe, ni aux URLs habituelles (/rss/newsfilm.xml,
 * /rss/actu.xml, /rss.xml — toutes en 404 RÉEL) ni via une balise
 * d'autodiscovery sur le site. Actus : scraping direct de
 * https://www.allocine.fr/news/cinema/. Films à l'affiche :
 * https://www.allocine.fr/film/aucinema/ (voir révision 2026-08-15 plus
 * bas). Sorties à venir : https://www.allocine.fr/film/agenda/ (calendrier
 * de sorties, RESTAURÉ à cette révision pour cette 3e section précisément —
 * voir plus bas pourquoi ce n'est plus un problème ici alors que ça l'était
 * pour "actuellement en salle").
 *
 * Pas d'IPC dédié : réutilise `window.matin.rss.fetchFeed` (même canal
 * générique que ETF/Colis, aucune restriction CORS côté process main).
 * Cascade de fetch — fetch direct EN PREMIER (testé en conditions réelles :
 * les pages répondent en clair, sans mur de cookies ni détection de bot) →
 * allorigins.win → jina.ai Reader en dernier recours (rendu Markdown, plus
 * pauvre : pas de date/genre par film).
 *
 * BUG CORRIGÉ LE 2026-08-15 (1re révision du jour) — "Aucune sortie cette
 * semaine" alors que des films sont bien en salle : `/film/agenda/` est un
 * calendrier d'UNE semaine de sorties à la fois, dont le "flip" vers la
 * semaine suivante n'est pas synchronisé avec un calcul mercredi↔mercredi
 * côté client — jamais adapté pour répondre à "qu'est-ce qui est
 * actuellement en salle" (plusieurs semaines de recul). Remplacé par
 * `/film/aucinema/` pour la section 2 (voir cinemaFetchNowPlaying).
 *
 * SECTION 3 AJOUTÉE À LA 2e RÉVISION DU 2026-08-15 (sur demande explicite,
 * juste après la 1re révision ci-dessus) — redemande PRÉCISÉMENT ce que
 * `/film/agenda/` sait faire (un calendrier d'UNE semaine de sorties), donc
 * cette page redevient la bonne source ici, à condition de ne PAS reproduire
 * l'erreur de la 1re révision (deviner la date ciblée par un calcul client
 * mercredi↔mercredi, qui peut diverger du "flip" réel du site). Corrigé en
 * LISANT la date ciblée directement dans le <title> de la page réelle
 * ("Sorties cinéma du mercredi 19 août 2026" → cinemaExtractAgendaTargetDate)
 * plutôt qu'en la recalculant — élimine complètement la classe de bug de la
 * 1re révision, la source fait foi. Filtrage par fenêtre [date extraite,
 * +7 jours) comme avant (élimine les ressorties de classiques mélangées sur
 * la même page, vérifié en direct : dates "21 juillet 1971"/"17 mars
 * 1993"/"1 juin 1951" présentes sur une vraie page à côté de vraies sorties
 * 2026), mais la date de départ vient maintenant de la page elle-même.
 */
window.MatinModules = window.MatinModules || {};

const CINEMA_NOWPLAYING_URL = 'https://www.allocine.fr/film/aucinema/';
const CINEMA_AGENDA_URL = 'https://www.allocine.fr/film/agenda/';
const CINEMA_NEWS_URL = 'https://www.allocine.fr/news/cinema/';

// Garde-fou contre une contamination de ressortie de classique sur
// /film/aucinema/ (section "actuellement en salle") — 120 jours (~4 mois)
// laisse largement de la marge pour un film encore en salle sur un long
// métrage porteur, sans laisser passer une vieille ressortie mal datée.
const CINEMA_MAX_AGE_DAYS = 120;

const CINEMA_NEWS_COUNT = 10; // total récupéré (4 visibles d'office + jusqu'à 6 dans le tiroir "Voir plus")
const CINEMA_NEWS_VISIBLE = 4;

// Ticker "actuellement en salle" — mêmes constantes que Bourse/France/Tech
// (voir rss-feed.js, RSS_TICKER_SEC_PER_ITEM/RSS_TICKER_MIN_SEC) : "même
// vitesse" demandé explicitement pour ce défilement.
const CINEMA_TICKER_SEC_PER_ITEM = 12;
const CINEMA_TICKER_MIN_SEC = 48;

// Diaporama "sorties à venir" — un film affiché 10s pile (6s à l'origine,
// allongé le 2026-08-31 sur demande explicite), puis glissement rapide
// (~300ms) vers le suivant, demandé explicitement en 2 temps distincts.
const CINEMA_SLIDESHOW_DISPLAY_MS = 10000;
const CINEMA_SLIDESHOW_TRANSITION_MS = 300;

const CINEMA_MONTHS_FR = {
  janvier: 0, février: 1, fevrier: 1, mars: 2, avril: 3, mai: 4, juin: 5,
  juillet: 6, août: 7, aout: 7, septembre: 8, octobre: 9, novembre: 10,
  décembre: 11, decembre: 11,
};

// "12 août 2026" → Date réelle (AlloCiné affiche toujours l'année).
function cinemaParseReleaseDate(text) {
  if (!text) return null;
  const m = text.match(/(\d{1,2})\s+([a-zA-Zéûôîàç]+)\s+(\d{4})/);
  if (!m) return null;
  const month = CINEMA_MONTHS_FR[m[2].toLowerCase()];
  if (month == null) return null;
  return new Date(parseInt(m[3], 10), month, parseInt(m[1], 10));
}

// "Actuellement en salle" (section 2) : déjà sorti (date <= aujourd'hui) et
// pas trop ancien (CINEMA_MAX_AGE_DAYS, garde-fou anti-ressortie de
// classique). `today` DOIT être normalisé à minuit par l'appelant.
function cinemaIsCurrentlyShowing(date, today) {
  if (!date) return false;
  if (date > today) return false; // pas encore sorti — ne devrait normalement pas arriver sur cette page
  const ageDays = (today - date) / 86400000;
  return ageDays <= CINEMA_MAX_AGE_DAYS;
}

// Lit la date ciblée directement dans le <title> de /film/agenda/ ("Sorties
// cinéma du mercredi 19 août 2026" → 19 août 2026) — voir SECTION 3 AJOUTÉE
// en tête de fichier pour pourquoi lire cette date plutôt que la recalculer.
function cinemaExtractAgendaTargetDate(html) {
  const m = html.match(/<title>[^<]*?(\d{1,2}\s+[a-zA-Zéûôîàç]+\s+\d{4})[^<]*<\/title>/i);
  return m ? cinemaParseReleaseDate(m[1]) : null;
}

// Fenêtre [date ciblée, +7 jours) — "cette semaine de sorties" au sens
// large (inclut une sortie décalée à un autre jour de la même semaine, ex.
// jour férié), jamais une simple égalité stricte à la date ciblée seule.
function cinemaIsInTargetWeek(date, weekStart) {
  if (!date || !weekStart) return false;
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  return date >= weekStart && date < weekEnd;
}

function cinemaFormatWeekLabel(weekStart) {
  if (!weekStart) return 'Sorties de la semaine prochaine';
  const label = weekStart.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return `Sorties du ${label}`;
}

// Parsing HTML (fetch direct ou allorigins, qui renvoient le HTML tel quel)
// via DOMParser plutôt que des regex sur du HTML — bien plus robuste aux
// variations de markup. Chaque film est un bloc `.card` contenant
// `figure.thumbnail img.thumbnail-img` (poster) et `.meta` (titre
// `.meta-title-link`, date `.date`, genre(s) `.meta-body-info .dark-grey-link`
// — plusieurs genres possibles, séparés par virgule dans le HTML, on ne
// garde que le premier pour rester compact), synopsis (`.synopsis
// .content-txt`, sœur de `.meta` dans `.card`, déjà tronqué par AlloCiné
// lui-même côté source, finit par "…"). Structure identique sur
// /film/aucinema/ ET /film/agenda/ (vérifié en direct pour les deux),
// réutilisée telle quelle pour les 2 sources.
// AlloCiné charge ses vignettes en lazy-load : `src` est un GIF transparent
// en data URI (placeholder) sur toutes les vignettes SAUF les 1-2 premières
// "au-dessus de la ligne de flottaison" — la vraie URL du poster est dans
// `data-src`. Prendre `src` tel quel affiche donc silencieusement un pixel
// transparent à la place du poster pour presque tous les films — une data
// URI valide ne déclenche JAMAIS l'icône "image cassée" du navigateur.
function cinemaExtractPoster(img) {
  if (!img) return null;
  const dataSrc = img.getAttribute('data-src');
  if (dataSrc) return dataSrc;
  const src = img.getAttribute('src');
  if (src && !src.startsWith('data:')) return src;
  return null;
}

function cinemaParseListHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const movies = [];
  doc.querySelectorAll('.meta').forEach((meta) => {
    const a = meta.querySelector('.meta-title-link');
    if (!a) return;
    const title = a.textContent.trim();
    if (!title) return;
    const href = a.getAttribute('href') || '';
    const link = href.startsWith('http') ? href : `https://www.allocine.fr${href}`;
    const dateEl = meta.querySelector('.date');
    const releaseDate = dateEl ? dateEl.textContent.trim() : null;
    const genreEl = meta.querySelector('.meta-body-info .dark-grey-link');
    const genre = genreEl ? genreEl.textContent.trim() : null;

    const card = meta.closest('.card') || meta.parentElement;
    const img = card ? card.querySelector('.thumbnail-img') : null;
    const poster = cinemaExtractPoster(img);
    const synopsisEl = card ? card.querySelector('.synopsis .content-txt') : null;
    const synopsis = synopsisEl ? synopsisEl.textContent.trim().replace(/\s+/g, ' ') : null;

    movies.push({ title, link, releaseDate, genre, poster, synopsis });
  });
  return movies;
}

// Repli Markdown (jina.ai Reader) — structure : "[![poster du film {titre}]
// (posterUrl)](filmUrl "{titre}")synopsis...". Pas de genre/date par film
// dans ce rendu (contrairement au HTML brut) : retombe sur une date
// PARTAGÉE pour tous les films de ce repli — "semaine du X" si le titre de
// page le donne (cas de /film/agenda/), sinon la date du jour (cas de
// /film/aucinema/, qui n'a plus ce format de titre — voir révision du
// 2026-08-15). `cinemaIsCurrentlyShowing`/`cinemaIsInTargetWeek` acceptent
// tous les deux cette date partagée normalement.
function cinemaParseListMarkdown(text) {
  const titleLine = (text.split('\n')[0] || '').replace(/^Title:\s*/, '').trim();
  const weekMatch = titleLine.match(/semaine du (.+)$/i);
  const sharedDate = weekMatch
    ? weekMatch[1].trim()
    : new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const movies = [];
  const seen = new Set();
  const re = /\[!\[Image \d+: poster du film [^\]]*\]\((https?:\/\/[^)]+)\)\]\((https:\/\/www\.allocine\.fr\/film\/fichefilm_gen_cfilm=\d+\.html)\s+"([^"]+)"\)/g;
  let m;
  const matches = [];
  while ((m = re.exec(text))) matches.push(m);

  matches.forEach((match, i) => {
    const link = match[2];
    if (seen.has(link)) return;
    seen.add(link);
    const start = match.index + match[0].length;
    const end = matches[i + 1] ? matches[i + 1].index : text.length;
    const synopsis = text.slice(start, end).trim().replace(/\s+/g, ' ').slice(0, 280) || null;
    movies.push({ title: match[3], link, releaseDate: sharedDate, genre: null, poster: match[1], synopsis });
  });
  return movies;
}

// Actus — mêmes classes `.meta`/`.meta-title-link` que les autres pages
// (structure identique : `.card` > `.meta` > `h2.meta-title` > `a.meta-title-link`).
// `href` filtré sur `/article/` : `.meta-title-link` existe aussi ailleurs
// sur la page (rubriques de navigation), jamais avec ce préfixe.
function cinemaParseNewsHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const items = [];
  doc.querySelectorAll('.meta-title-link').forEach((a) => {
    if (items.length >= CINEMA_NEWS_COUNT) return;
    const href = a.getAttribute('href') || '';
    if (!href.startsWith('/article/')) return;
    const title = a.textContent.trim();
    if (!title) return;
    items.push({ title, link: `https://www.allocine.fr${href}` });
  });
  return items;
}

// Repli Markdown (jina.ai Reader) — liens "[titre](url article)" tels que
// rendus par jina.ai pour cette page.
function cinemaParseNewsMarkdown(text) {
  const items = [];
  const seen = new Set();
  const re = /\[([^\]]{10,200})\]\((https:\/\/www\.allocine\.fr\/article\/fichearticle_gen_carticle=\d+\.html)\)/g;
  let m;
  while ((m = re.exec(text)) && items.length < CINEMA_NEWS_COUNT) {
    const link = m[2];
    if (seen.has(link)) continue;
    seen.add(link);
    items.push({ title: m[1].trim(), link });
  }
  return items;
}

async function cinemaFetchNews() {
  const attempts = [
    { method: 'direct', url: CINEMA_NEWS_URL, parse: cinemaParseNewsHtml },
    { method: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(CINEMA_NEWS_URL)}`, parse: cinemaParseNewsHtml },
    { method: 'jina.ai', url: `https://r.jina.ai/${CINEMA_NEWS_URL}`, parse: cinemaParseNewsMarkdown },
  ];

  let lastErr = new Error('Aucune méthode disponible');
  for (const { method, url, parse } of attempts) {
    try {
      const raw = await window.matin.rss.fetchFeed(url);
      const items = parse(raw);
      console.log(`[Cinéma] actus AlloCiné via ${method} — ${items.length} article(s) trouvé(s)`);
      if (items.length) return items;
      lastErr = new Error(`Aucun article extrait (${method})`);
    } catch (err) {
      console.warn(`[Cinéma] actus AlloCiné via ${method} échoué`, err.message);
      lastErr = err;
    }
  }
  throw lastErr;
}

// Repli poster : pour un film dont la liste n'a fourni AUCUNE URL exploitable
// (data-src absent, src une simple data URI de placeholder — voir
// cinemaExtractPoster) — va chercher la balise og:image sur la fiche du film
// elle-même. Cascade direct → allorigins → jina.ai (Reader, rendu Markdown ;
// l'image principale d'une page y apparaît en tête sous la forme
// `![...](url)`) — même filet que le reste du module au cas où AlloCiné
// bloquerait un fetch direct pour cette page précise.
async function cinemaFetchOgImage(movieUrl) {
  const attempts = [
    { method: 'direct', url: movieUrl, markdown: false },
    { method: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(movieUrl)}`, markdown: false },
    { method: 'jina.ai', url: `https://r.jina.ai/${movieUrl}`, markdown: true },
  ];

  for (const { method, url, markdown } of attempts) {
    try {
      const raw = await window.matin.rss.fetchFeed(url);
      const found = markdown
        ? (raw.match(/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/) || [])[1]
        : ((raw.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
            || raw.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)) || [])[1];
      if (found) {
        console.log(`[Cinéma] og:image repêché via ${method} pour ${movieUrl}`);
        return found;
      }
    } catch (err) {
      console.warn(`[Cinéma] og:image via ${method} échoué pour ${movieUrl}`, err.message);
    }
  }
  return null;
}

// Complète en parallèle le poster des films qui en manquent encore après le
// parsing — en pratique une poignée tout au plus (la quasi-totalité des
// films ont un data-src exploitable), donc pas besoin de limiter la
// concurrence.
async function cinemaFillMissingPosters(movies) {
  const missing = movies.filter(m => !m.poster);
  if (!missing.length) return movies;

  await Promise.all(missing.map(async (movie) => {
    try {
      movie.poster = await cinemaFetchOgImage(movie.link);
    } catch (err) {
      console.warn(`[Cinéma] Repli og:image échoué pour "${movie.title}"`, err.message);
    }
  }));
  return movies;
}

// Section 2 — "actuellement en salle" (voir révision 2026-08-15 en tête de
// fichier) : garde tout film dont la date est <= aujourd'hui et pas plus
// vieille que CINEMA_MAX_AGE_DAYS.
async function cinemaFetchNowPlaying() {
  const attempts = [
    { method: 'direct', url: CINEMA_NOWPLAYING_URL, parse: cinemaParseListHtml },
    { method: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(CINEMA_NOWPLAYING_URL)}`, parse: cinemaParseListHtml },
    { method: 'jina.ai', url: `https://r.jina.ai/${CINEMA_NOWPLAYING_URL}`, parse: cinemaParseListMarkdown },
  ];

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  console.log(`[Cinéma] Date de référence (aujourd'hui) : ${today.toDateString()}`);

  let lastErr = new Error('Aucune méthode de suivi disponible');
  for (const { method, url, parse } of attempts) {
    try {
      const raw = await window.matin.rss.fetchFeed(url);
      const allMovies = parse(raw);
      const rawDates = [...new Set(allMovies.map(m => m.releaseDate).filter(Boolean))];
      console.log(`[Cinéma] à l'affiche AlloCiné via ${method} — ${allMovies.length} film(s) trouvé(s) avant filtrage, dates brutes : ${rawDates.join(' | ') || '(aucune)'}`);
      if (!allMovies.length) { lastErr = new Error(`Aucun film extrait (${method})`); continue; }

      const movies = allMovies.filter(m => cinemaIsCurrentlyShowing(cinemaParseReleaseDate(m.releaseDate), today));
      console.log(`[Cinéma] ${movies.length} film(s) actuellement en salle (sur ${allMovies.length} trouvé(s))`);

      return await cinemaFillMissingPosters(movies);
    } catch (err) {
      console.warn(`[Cinéma] à l'affiche AlloCiné via ${method} échoué`, err.message);
      lastErr = err;
    }
  }
  throw lastErr;
}

// Section 3 — "sorties de la semaine prochaine" (voir révision 2026-08-15,
// 2e partie, en tête de fichier) : date ciblée LUE dans la page elle-même
// (jamais recalculée côté client), fenêtre [date ciblée, +7 jours).
async function cinemaFetchUpcoming() {
  const attempts = [
    { method: 'direct', url: CINEMA_AGENDA_URL, parse: cinemaParseListHtml, extractTarget: cinemaExtractAgendaTargetDate },
    { method: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(CINEMA_AGENDA_URL)}`, parse: cinemaParseListHtml, extractTarget: cinemaExtractAgendaTargetDate },
    { method: 'jina.ai', url: `https://r.jina.ai/${CINEMA_AGENDA_URL}`, parse: cinemaParseListMarkdown, extractTarget: null },
  ];

  let lastErr = new Error('Aucune méthode de suivi disponible');
  for (const { method, url, parse, extractTarget } of attempts) {
    try {
      const raw = await window.matin.rss.fetchFeed(url);
      const allMovies = parse(raw);
      // La date ciblée du repli Markdown vient de cinemaParseListMarkdown
      // elle-même (sharedDate, voir sa doc) — pas d'extraction séparée là,
      // on relit juste la date du 1er film parsé (tous partagent la même).
      const targetDate = extractTarget ? extractTarget(raw) : cinemaParseReleaseDate(allMovies[0]?.releaseDate);
      const rawDates = [...new Set(allMovies.map(m => m.releaseDate).filter(Boolean))];
      console.log(`[Cinéma] agenda AlloCiné via ${method} — ${allMovies.length} film(s) trouvé(s) avant filtrage, date ciblée : ${targetDate ? targetDate.toDateString() : 'inconnue'}, dates brutes : ${rawDates.join(' | ') || '(aucune)'}`);
      if (!allMovies.length || !targetDate) { lastErr = new Error(`Aucun film/date extrait (${method})`); continue; }

      const movies = allMovies.filter(m => cinemaIsInTargetWeek(cinemaParseReleaseDate(m.releaseDate), targetDate));
      console.log(`[Cinéma] ${movies.length} film(s) dans la semaine de sorties ciblée (${targetDate.toDateString()})`);

      return { movies: await cinemaFillMissingPosters(movies), targetDate };
    } catch (err) {
      console.warn(`[Cinéma] agenda AlloCiné via ${method} échoué`, err.message);
      lastErr = err;
    }
  }
  throw lastErr;
}

function cinemaInitial(title) {
  const t = (title || '').trim();
  return t ? t[0].toUpperCase() : '?';
}

function cinemaPlaceholderHtml(title, className) {
  return `<div class="${className} cinema-poster-empty">${cinemaInitial(title)}</div>`;
}

// Actus — 4 premiers items TOUJOURS visibles + jusqu'à 6 de plus dans un
// tiroir repliable, liste STATIQUE (pas de défilement, demandé explicitement
// section 1). Le tiroir est TOUJOURS présent dans le DOM (jamais omis quand
// replié) et animé en pur CSS (grid-template-rows, voir
// .cinema-news-dropdown-inner dans style.css) — même principe que
// .fdj-grids-collapse : le clic sur "Voir plus" ne fait QUE basculer une
// classe, aucun re-render, la transition a donc un état de départ à animer.
function cinemaNewsListHtml(items) {
  if (!items.length) return `<div class="module-empty">Aucune actu trouvée.</div>`;

  const visible = items.slice(0, CINEMA_NEWS_VISIBLE);
  const rest = items.slice(CINEMA_NEWS_VISIBLE);
  const itemHtml = (it) => `<div class="cinema-news-item" data-link="${it.link}">${it.title}</div>`;

  return `
    <div class="cinema-news-list">${visible.map(itemHtml).join('')}</div>
    ${rest.length ? `
    <button type="button" class="cinema-news-toggle" id="cinema-news-toggle">Voir plus ▼</button>
    <div class="cinema-news-dropdown" id="cinema-news-dropdown">
      <div class="cinema-news-dropdown-inner">
        <div class="cinema-news-list">${rest.map(itemHtml).join('')}</div>
      </div>
    </div>` : ''}`;
}

// Section 2 — ligne compacte (vignette 40px + titre + genre), item du
// ticker vertical défilant (voir .sports-ticker-v* dans style.css,
// réutilisées pour l'animation — même mécanisme/vitesse que Bourse). PAS de
// synopsis ici (demandé explicitement "compact", contrairement à la section 3).
function cinemaNowPlayingItemHtml(movie) {
  const safeTitle = (movie.title || '').replace(/"/g, '&quot;');
  const poster = movie.poster
    ? `<img class="cinema-nowplaying-poster" src="${movie.poster}" alt="" loading="lazy" data-title="${safeTitle}">`
    : cinemaPlaceholderHtml(movie.title, 'cinema-nowplaying-poster');

  return `
    <div class="sports-ticker-vitem cinema-nowplaying-item" data-link="${movie.link}">
      ${poster}
      <span class="cinema-nowplaying-title">${movie.title}</span>
      ${movie.genre ? `<span class="cinema-nowplaying-genre">${movie.genre}</span>` : ''}
    </div>`;
}

// Section 3 — une diapositive pleine largeur (grande vignette bandeau +
// titre + genre + synopsis 2-3 lignes).
function cinemaUpcomingSlideHtml(movie) {
  const safeTitle = (movie.title || '').replace(/"/g, '&quot;');
  const poster = movie.poster
    ? `<img class="cinema-upcoming-poster" src="${movie.poster}" alt="" loading="lazy" data-title="${safeTitle}">`
    : cinemaPlaceholderHtml(movie.title, 'cinema-upcoming-poster');

  return `
    <div class="cinema-upcoming-slide" data-link="${movie.link}">
      ${poster}
      <div class="cinema-upcoming-meta">
        <span class="cinema-upcoming-title">${movie.title}</span>
        ${movie.genre ? `<span class="cinema-upcoming-genre">${movie.genre}</span>` : ''}
        ${movie.synopsis ? `<p class="cinema-upcoming-synopsis">${movie.synopsis}</p>` : ''}
      </div>
    </div>`;
}

// Diaporama — un film à la fois, glissement horizontal (voir en-tête du
// fichier pour les durées demandées). Technique du "clone en fin de piste"
// pour une boucle sans à-coup visuel : la piste contient [film0..filmN-1,
// clone de film0], on glisse normalement jusqu'au clone puis on saute SANS
// transition à la position 0 réelle (invisible, clone strictement identique
// à l'original) plutôt que de glisser en sens inverse jusqu'au début.
// Le timer est retourné pour que l'appelant le stocke sur le conteneur et le
// nettoie au prochain rendu (voir render() plus bas, refreshMs 24h sur ce
// module — sans ce nettoyage, un re-rendu externe empilerait un 2e timer
// agissant sur une piste DOM déjà remplacée par le rendu suivant, même
// classe de bug que celle historiquement évitée pour ETF/Crypto/Podcast).
function cinemaStartUpcomingSlideshow(track, count) {
  if (count <= 1) return null;
  let index = 0;
  let advanceTimer = null;

  function goTo(i, animate) {
    track.style.transition = animate ? `transform ${CINEMA_SLIDESHOW_TRANSITION_MS}ms ease` : 'none';
    track.style.transform = `translateX(-${i * 100}%)`;
  }

  function advance() {
    index += 1;
    goTo(index, true);
    if (index === count) {
      // Piste sur le clone (position count = clone de l'index 0) : après la
      // transition, saut instantané et invisible vers le VRAI index 0.
      setTimeout(() => {
        index = 0;
        goTo(0, false);
      }, CINEMA_SLIDESHOW_TRANSITION_MS + 20);
    }
  }

  advanceTimer = setInterval(advance, CINEMA_SLIDESHOW_DISPLAY_MS);
  return advanceTimer;
}

window.MatinModules.cinema = {
  async render(container, _config, _google, setBadge) {
    // Nettoyage du timer de diaporama d'un rendu précédent (voir
    // cinemaStartUpcomingSlideshow) — indispensable puisque ce module a un
    // `refreshMs` externe (24h, voir dashboard.js) qui peut ré-appeler
    // render() sur ce même conteneur bien après le 1er rendu.
    if (container._cinemaSlideshowTimer) {
      clearInterval(container._cinemaSlideshowTimer);
      container._cinemaSlideshowTimer = null;
    }

    setBadge('…');
    container.innerHTML = `<div class="loading-spinner" style="margin:20px auto;width:18px;height:18px"></div>`;

    // Les 3 sections sont des sources INDÉPENDANTES — un échec de l'une
    // n'empêche jamais les autres de s'afficher (Promise.allSettled, pas
    // Promise.all).
    const [newsResult, nowPlayingResult, upcomingResult] = await Promise.allSettled([
      cinemaFetchNews(),
      cinemaFetchNowPlaying(),
      cinemaFetchUpcoming(),
    ]);

    const news = newsResult.status === 'fulfilled' ? newsResult.value : [];
    const nowPlaying = nowPlayingResult.status === 'fulfilled' ? nowPlayingResult.value : [];
    const upcoming = upcomingResult.status === 'fulfilled' ? upcomingResult.value.movies : [];
    const upcomingTarget = upcomingResult.status === 'fulfilled' ? upcomingResult.value.targetDate : null;
    if (newsResult.status === 'rejected') console.error('[Cinéma] Actus', newsResult.reason);
    if (nowPlayingResult.status === 'rejected') console.error('[Cinéma] Actuellement en salle', nowPlayingResult.reason);
    if (upcomingResult.status === 'rejected') console.error('[Cinéma] Sorties à venir', upcomingResult.reason);

    if (!news.length && !nowPlaying.length && !upcoming.length) {
      container.innerHTML = `<span class="module-error">Cinéma indisponible</span>`;
      setBadge('⚠');
      return;
    }

    container.innerHTML = `
      <div class="cinema-module">
        <div class="cinema-news-section">
          <div class="cinema-section-title">Actus cinéma</div>
          ${cinemaNewsListHtml(news)}
        </div>
        <div class="cinema-separator"></div>
        <div class="cinema-nowplaying-section">
          <div class="cinema-section-title">Films actuellement en salle</div>
          <div class="sports-ticker-vwrap cinema-nowplaying-vwrap" id="cinema-nowplaying-ticker">
            <div class="sports-ticker-vtrack">
              ${nowPlaying.length ? '' : '<div class="module-empty">Aucun film actuellement en salle.</div>'}
            </div>
          </div>
        </div>
        <div class="cinema-separator"></div>
        <div class="cinema-upcoming-section">
          <div class="cinema-section-title">${cinemaFormatWeekLabel(upcomingTarget)}</div>
          <div class="cinema-upcoming-slideshow" id="cinema-upcoming-slideshow">
            ${upcoming.length ? '' : '<div class="module-empty">Sorties à venir non disponibles.</div>'}
          </div>
        </div>
      </div>`;

    // ─── Section 1 : actus (statique) ───────────────────────────────────
    container.querySelectorAll('.cinema-news-item').forEach((el) => {
      el.addEventListener('click', () => window.matin.shell.openExternal(el.dataset.link));
    });

    const toggleBtn = container.querySelector('#cinema-news-toggle');
    const dropdown = container.querySelector('#cinema-news-dropdown');
    if (toggleBtn && dropdown) {
      toggleBtn.addEventListener('click', () => {
        const expanded = dropdown.classList.toggle('open');
        toggleBtn.textContent = expanded ? 'Voir moins ▲' : 'Voir plus ▼';
      });
    }

    // ─── Section 2 : actuellement en salle (ticker compact, hauteur fixe
    // à 2 lignes visibles — voir .cinema-nowplaying-vwrap dans style.css) ──
    if (nowPlaying.length) {
      const tickerSlot = container.querySelector('#cinema-nowplaying-ticker');
      const itemsHtml = nowPlaying.map(cinemaNowPlayingItemHtml).join('');
      const track = document.createElement('div');
      track.className = 'sports-ticker-vtrack';
      track.innerHTML = itemsHtml + itemsHtml; // dupliqué : boucle continue sans à-coup (voir @keyframes sports-ticker-v, translateY -50%)
      track.style.animationDuration = `${Math.max(nowPlaying.length * CINEMA_TICKER_SEC_PER_ITEM, CINEMA_TICKER_MIN_SEC)}s`;

      tickerSlot.innerHTML = '';
      tickerSlot.appendChild(track);

      tickerSlot.querySelectorAll('.cinema-nowplaying-item').forEach((el) => {
        el.addEventListener('click', () => window.matin.shell.openExternal(el.dataset.link));
      });
      // Une URL de poster trouvée au fetch peut échouer à charger dans le
      // navigateur (404, hotlink protection AlloCiné...) — bascule vers la
      // vignette "lettre initiale".
      tickerSlot.querySelectorAll('img.cinema-nowplaying-poster').forEach((img) => {
        img.addEventListener('error', () => {
          img.outerHTML = cinemaPlaceholderHtml(img.dataset.title, 'cinema-nowplaying-poster');
        }, { once: true });
      });
    }

    // ─── Section 3 : sorties à venir (diaporama, un film à la fois) ─────
    if (upcoming.length) {
      const slideshow = container.querySelector('#cinema-upcoming-slideshow');
      // Clone du 1er film ajouté en fin de piste — voir
      // cinemaStartUpcomingSlideshow pour la technique de boucle sans à-coup.
      const slidesHtml = upcoming.map(cinemaUpcomingSlideHtml).join('') + cinemaUpcomingSlideHtml(upcoming[0]);
      const track = document.createElement('div');
      track.className = 'cinema-upcoming-track';
      track.innerHTML = slidesHtml;
      slideshow.innerHTML = '';
      slideshow.appendChild(track);

      slideshow.querySelectorAll('.cinema-upcoming-slide').forEach((el) => {
        el.addEventListener('click', () => window.matin.shell.openExternal(el.dataset.link));
      });
      slideshow.querySelectorAll('img.cinema-upcoming-poster').forEach((img) => {
        img.addEventListener('error', () => {
          img.outerHTML = cinemaPlaceholderHtml(img.dataset.title, 'cinema-upcoming-poster');
        }, { once: true });
      });

      container._cinemaSlideshowTimer = cinemaStartUpcomingSlideshow(track, upcoming.length);
    }

    setBadge(`${nowPlaying.length}`);
  },
};
