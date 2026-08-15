/**
 * Détection automatique du sport (via TheSportsDB) et liste blanche de
 * sources RSS associées — partagé entre le module Sports (ol.js, qui l'utilise
 * pour savoir quoi récupérer) et la page de configuration (config.js, qui
 * l'utilise pour construire les cases à cocher). Un seul fichier pour éviter
 * que les deux dérivent l'un de l'autre : une source cochée côté Paramètres
 * doit correspondre exactement à ce qui est effectivement récupéré côté
 * dashboard.
 */
window.SportsSources = (function () {
  const MAX_SOURCES = 5;

  // URLs L'Équipe : l'ancien format (lequipe.fr/rss/actu_rss_{Sport}.xml) est
  // mort (404, vérifié le 2026-08-03) — remplacé par le flux dwh.lequipe.fr
  // actuellement en service, dont le paramètre `path` attend le slug interne
  // du site (pas forcément identique à l'ancien nom de fichier — ex.
  // "Basket", pas "Basket-ball" : ce dernier renvoie un flux valide mais VIDE).
  // Chaque slug ci-dessous a été vérifié individuellement (contenu réel,
  // ~50 items, pas juste un flux générique qui répondrait pareil à n'importe
  // quel chemin).
  //
  // Eurosport a été retiré entièrement (tous sports) : le site bloque tout
  // accès non-navigateur au niveau du site entier (403 sur la page d'accueil
  // elle-même, pas seulement sur le flux RSS), et même via un proxy capable de
  // passer ce blocage (jina.ai Reader, vérifié), aucun flux RSS n'a pu être
  // trouvé sur le site — il semble avoir été purement et simplement retiré
  // côté Eurosport, pas juste déplacé. Un proxy n'aide pas à fetcher un flux
  // qui n'existe plus.
  const CATALOG = {
    football: [
      { label: "L'Équipe", url: 'https://dwh.lequipe.fr/api/edito/rss?path=/Football' },
      { label: 'RMC Sport', url: 'https://rmcsport.bfmtv.com/rss/football/' },
      { label: 'Foot Mercato', url: 'https://www.footmercato.net/flux-rss/' },
    ],
    basketball: [
      { label: 'BeBasket', url: 'https://www.bebasket.fr/feed/' },
      { label: "L'Équipe Basket", url: 'https://dwh.lequipe.fr/api/edito/rss?path=/Basket' },
    ],
    rugby: [
      { label: 'Rugbyrama', url: 'https://www.rugbyrama.fr/rss.xml' },
      { label: 'Midi Olympique', url: 'https://www.midi-olympique.fr/feed/' },
      { label: "L'Équipe Rugby", url: 'https://dwh.lequipe.fr/api/edito/rss?path=/Rugby' },
    ],
    f1: [
      { label: 'Nextgen-auto', url: 'https://www.nextgen-auto.com/feed/' },
      { label: "L'Équipe F1", url: 'https://dwh.lequipe.fr/api/edito/rss?path=/Formule-1' },
    ],
    cyclisme: [
      { label: "L'Équipe Vélo", url: 'https://dwh.lequipe.fr/api/edito/rss?path=/Cyclisme' },
    ],
  };

  const CATEGORY_LABELS = {
    football: 'Football', basketball: 'Basketball', rugby: 'Rugby', f1: 'Formule 1', cyclisme: 'Cyclisme',
  };

  // TheSportsDB n'a pas de catégorie "Formula 1" dédiée : tout sport moteur
  // (F1, MotoGP, Dakar...) est classé "Motorsport" — rattaché à F1 faute de
  // plus précis (limitation de la source de données, pas de notre mapping).
  function mapSportToCategory(strSport) {
    const s = (strSport || '').toLowerCase();
    if (s.includes('soccer')) return 'football';
    if (s.includes('basketball')) return 'basketball';
    if (s.includes('rugby')) return 'rugby';
    if (s.includes('motorsport') || s.includes('formula')) return 'f1';
    if (s.includes('cycling')) return 'cyclisme';
    return null;
  }

  function normalizeWebsiteUrl(raw) {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  }

  // Repère un flux RSS auto-découvrable (<link rel="alternate"
  // type="application/rss+xml">) sur la page d'accueil du club. En pratique,
  // la plupart des sites modernes n'exposent plus cette balise (vérifié sur
  // plusieurs sites de clubs) — on retombe alors sur un lien direct vers le
  // site (isRss: false), conformément à la consigne.
  async function discoverClubSource(website, teamLabel) {
    const url = normalizeWebsiteUrl(website);
    if (!url) return null;

    const label = `Site officiel — ${teamLabel}`;
    try {
      const html = await window.matin.rss.fetchFeed(url);
      const linkTag = (html.match(/<link\b[^>]*>/gi) || []).find(tag =>
        /rel=["']alternate["']/i.test(tag) && /type=["']application\/rss\+xml["']/i.test(tag)
      );
      const hrefMatch = linkTag?.match(/href=["']([^"']+)["']/i);
      if (hrefMatch) {
        return { label, url: new URL(hrefMatch[1], url).href, isRss: true };
      }
    } catch (err) {
      console.warn('[Sports] Découverte RSS du site officiel échouée', err);
    }
    return { label, url, isRss: false };
  }

  // Interroge TheSportsDB pour l'équipe donnée et construit la liste des
  // sources candidates (liste blanche du sport détecté + site officiel du
  // club), plafonnée à MAX_SOURCES.
  async function detectSportSources(team) {
    const res = await fetch(`https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${encodeURIComponent(team)}`);
    if (!res.ok) throw new Error(`Recherche équipe KO (${res.status})`);
    const data = await res.json();
    const found = data.teams?.[0];
    if (!found) throw new Error('Équipe introuvable sur TheSportsDB');

    const category = mapSportToCategory(found.strSport);
    const staticList = category ? CATALOG[category] : [];
    const clubSource = await discoverClubSource(found.strWebsite, found.strTeam || team);

    const list = [...staticList];
    if (clubSource && !list.some(s => s.url === clubSource.url)) list.push(clubSource);

    return {
      category,
      sportLabel: category ? CATEGORY_LABELS[category] : (found.strSport || null),
      list: list.slice(0, MAX_SOURCES),
    };
  }

  return { MAX_SOURCES, CATALOG, CATEGORY_LABELS, mapSportToCategory, detectSportSources };
})();
