/**
 * FDJ — moteur de rendu partagé par les 3 modules dashboard indépendants
 * (Loto, EuroMillions, EuroDreams — voir fdj-loto.js/fdj-euromillions.js/
 * fdj-eurodreams.js), scindés depuis un unique module FDJ le 2026-08-04 sur
 * demande explicite, pour permettre d'activer/déplacer/redimensionner chaque
 * jeu séparément. Même convention que rss-feed.js/makeRssModule (un seul
 * moteur paramétré, un fichier fin par instance).
 *
 * Chaque module gère désormais un seul jeu : plus besoin des Sets globaux
 * keyés par jeu de l'ancien fdj.js (état "grilles dépliées"/"confidentialité"
 * local à l'instance via closure) ni du niveau d'imbrication "carte FDJ >
 * jeu expansible > détail" — la carte EST le jeu, toujours dépliée.
 *
 * Le `config` du module (`{ grids, codes }`) est désormais celui du jeu
 * directement, plus imbriqué sous `config.<jeu>` comme dans l'ancien module
 * FDJ unique (voir main.js, migrateFdjModule pour la migration du store).
 */
window.MatinModules = window.MatinModules || {};

window.FdjCommon = (function () {
  const FDJ_REFRESH_MS = 6 * 60 * 60 * 1000;
  const FDJ_CACHE_PREFIX = 'matin-fdj-last-';
  const FDJ_CODES_CACHE_KEY = 'matin-fdj-codes-cache';
  const FDJ_PRIVACY_PREFIX = 'matin-fdj-privacy-';

  function cacheKey(gameKey) {
    return `${FDJ_CACHE_PREFIX}${gameKey}`;
  }

  function loadCache(gameKey) {
    try {
      const raw = localStorage.getItem(cacheKey(gameKey));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveCache(gameKey, draw) {
    try {
      localStorage.setItem(cacheKey(gameKey), JSON.stringify({ draw, fetchedAt: Date.now() }));
    } catch (err) {
      console.warn('[FDJ] Échec de mise en cache', err);
    }
  }

  // Codes gagnants Loto/MyMillion : une seule page les republie tous les deux
  // (voir main.js, ipcMain 'fdj:fetchWinningCodes') — cache partagé entre les
  // modules Loto et EuroMillions plutôt qu'un par module, pas de raison de le
  // dupliquer puisqu'il vient du même fetch.
  function loadCodesCache() {
    try {
      const raw = localStorage.getItem(FDJ_CODES_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveCodesCache(codes) {
    try {
      localStorage.setItem(FDJ_CODES_CACHE_KEY, JSON.stringify({ codes, fetchedAt: Date.now() }));
    } catch (err) {
      console.warn('[FDJ] Échec de mise en cache des codes', err);
    }
  }

  function normalizeCode(code) {
    return (code || '').replace(/\s+/g, '').toUpperCase();
  }

  async function fetchAndNormalizeDraw(game) {
    const row = await window.matin.fdj.fetchLatestDraw(game.key);
    const draw = window.FdjGames.normalizeDrawRow(game, row);
    if (!draw) throw new Error('Format CSV inattendu');
    return draw;
  }

  // ─── Sélecteur de jour(s) de tirage joués (2026-09-13, sur demande
  // explicite) ─────────────────────────────────────────────────────────
  const FDJ_RECENT_DRAWS_COUNT = 12; // plusieurs semaines d'historique — largement assez pour tout sous-ensemble de game.drawDays

  // Parse une date FDJ "JJ/MM/AAAA" — CORRIGE un bug bloquant du pseudocode
  // fourni avec la demande (`new Date(draw.date)`) : vérifié en direct sur le
  // vrai CSV FDJ (curl), le format est bien JJ/MM/AAAA français — `new
  // Date("12/09/2026")` natif l'interprète en MM/JJ/AAAA (convention US) et
  // renvoie le 9 DÉCEMBRE au lieu du 12 SEPTEMBRE, un jour de la semaine
  // complètement différent. Sans ce correctif, le filtrage par jour aurait
  // été silencieusement FAUX (pas d'erreur, juste le mauvais tirage choisi).
  function parseFdjDate(dateStr) {
    if (!dateStr) return null;
    const [d, m, y] = dateStr.split('/').map(Number);
    if (!d || !m || !y) return null;
    return new Date(y, m - 1, d);
  }

  // `draws` déjà triés du plus récent au plus ancien (voir fetchRecentDraws
  // côté main.js, qui lit le CSV dans cet ordre) ; `playDays` = tableau de
  // NUMÉROS de jour (0=dimanche..6=samedi, convention Date.getDay(), voir
  // fdj-games.js DAY_LABELS) — PAS des chaînes françaises comme le
  // pseudocode de la demande (adapté pour rester cohérent avec
  // `game.drawDays`, déjà au même format dans ce projet).
  function getLastPlayedDraw(draws, playDays) {
    return draws.find((draw) => {
      const d = parseFdjDate(draw.date);
      return d && playDays.includes(d.getDay());
    }) || null;
  }

  // Filet de sécurité (2026-09-13, sur demande explicite, "ne pas simuler
  // les gains sur un tirage non joué") — RE-VÉRIFIE, au moment d'afficher
  // (pas seulement au moment de choisir le tirage), que le tirage affiché
  // tombe bien un jour joué. `getLastPlayedDraw` ci-dessus garantit déjà ça
  // pour le chemin "jours filtrés", MAIS le repli sur le cache après un échec
  // réseau (voir fetchAndRender plus bas, `loadCache`) peut renvoyer un
  // tirage mis en cache AVANT que l'utilisateur ne restreigne ses jours (ex.
  // un tirage de vendredi caché quand tous les jours étaient encore cochés,
  // resservi tel quel après un échec réseau alors que seul le mardi est
  // maintenant joué) — ce filet couvre précisément ce cas, sans toucher à la
  // logique de comparaison grilles/résultats elle-même (computeGridResult,
  // fdj-games.js, INCHANGÉE). Date illisible/absente → considéré "joué" par
  // défaut (fail-open), jamais de faux avertissement sur un tirage qu'on ne
  // sait pas dater.
  function drawIsOnPlayedDay(draw, playDays) {
    if (!draw) return true;
    const d = parseFdjDate(draw.date);
    if (!d) return true;
    return playDays.includes(d.getDay());
  }

  function formatCountdown(target) {
    const diffMs = target - Date.now();
    if (diffMs <= 0) return 'imminent';
    const totalMin = Math.floor(diffMs / 60000);
    const days = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins = totalMin % 60;
    if (days > 0) return `dans ${days}j ${hours}h`;
    if (hours > 0) return `dans ${hours}h${mins > 0 ? ` ${mins}min` : ''}`;
    return `dans ${mins}min`;
  }

  function nextDrawInfo(game) {
    const now = new Date();
    const [h, m] = game.drawTime;
    for (let i = 0; i <= 7; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);
      d.setHours(h, m, 0, 0);
      if (game.drawDays.includes(d.getDay()) && d > now) {
        const dayLabel = d.toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
        return `${dayLabel} · ${formatCountdown(d)}`;
      }
    }
    return '';
  }

  function ballHtml(game, value, isSpecial, matched) {
    const classes = ['fdj-ball', game.color];
    if (isSpecial) classes.push('special');
    if (matched) classes.push('matched');
    return `<span class="${classes.join(' ')}">${value}</span>`;
  }

  // `noMatchForDays` (2026-09-13, sur demande explicite) — DISTINCT d'un
  // échec réseau/résultats indisponibles : le fetch a réussi, mais aucun
  // tirage récent ne tombe un jour sélectionné par l'utilisateur (voir
  // getLastPlayedDraw plus bas) — message dédié demandé explicitement,
  // jamais confondu avec "Résultats indisponibles" (qui, lui, reste
  // inchangé pour les vrais échecs réseau/CSV invalide).
  function drawBlockHtml(game, draw, stale, noMatchForDays) {
    if (!draw) {
      const message = noMatchForDays
        ? 'Aucun tirage disponible pour les jours sélectionnés.'
        : 'Résultats indisponibles';
      return `<div class="fdj-draw-block"><span class="fdj-empty">${message}</span></div>`;
    }
    const balls = draw.numbers.map(n => ballHtml(game, n, false, false)).join('')
      + draw.special.map(n => ballHtml(game, n, true, false)).join('');
    return `
      <div class="fdj-draw-block">
        <span class="fdj-draw-label">Dernier tirage${draw.date ? ` — ${draw.date}` : ''}</span>
        <div class="fdj-draw-balls">${balls}</div>
        ${stale ? `<span class="fdj-stale-notice">⚠ Données non disponibles actuellement — dernier résultat connu affiché</span>` : ''}
      </div>`;
  }

  // "Variable" en italique gris (2026-09-13, sur demande explicite, LOTO +
  // EUROMILLIONS + EuroDreams — les 3 partagent ce même moteur de rendu,
  // voir en-tête de fichier) — dès que le montant à afficher est nul, vide,
  // ou contient "partagée" (la plupart des rangs pari-mutuel n'ont ni
  // fixedAmount ni label distinct, voir fdj-games.js GAMES, et retombent sur
  // le libellé générique 'cagnotte partagée' ci-dessous) : un montant réel
  // dépendant de la cagnotte/du nombre de gagnants n'est jamais connu à
  // l'avance, "Variable" est plus honnête qu'un libellé figé. Les rangs AVEC
  // un label distinct (ex. "Jackpot (min. 2 000 000 €)") ne contiennent pas
  // "partagée" et restent donc affichés tels quels.
  function formatPrizeAmount(value) {
    if (value == null || value === ''
      || (typeof value === 'string' && value.toLowerCase().includes('partagée'))) {
      return `<span class="fdj-prize-variable">Variable</span>`;
    }
    if (typeof value === 'number') return `${value.toFixed(2).replace('.', ',')} €`;
    return value;
  }

  function gridRankHtml(game, result, draw) {
    if (!draw) return `<span class="fdj-grid-rank miss">—</span>`;
    if (!result.rank) return `<span class="fdj-grid-rank miss">Aucun gain</span>`;

    const r = result.rank;
    const amount = formatPrizeAmount(r.fixedAmount != null ? r.fixedAmount : (r.label || 'cagnotte partagée'));
    const specialPart = result.specialsMatched > 0 ? ` + ${game.specialLabel.toLowerCase()}` : '';
    return `<span class="fdj-grid-rank hit">${result.numbersMatched} numéro${result.numbersMatched > 1 ? 's' : ''}${specialPart} → Rang ${r.rank} — ${amount}</span>`;
  }

  function gridRowHtml(game, grid, draw) {
    const drawnNumbers = new Set(draw?.numbers || []);
    const drawnSpecials = new Set(draw?.special || []);

    const numberBalls = (grid.numbers || []).map(n => {
      if (n == null) return `<span class="fdj-ball placeholder">?</span>`;
      return ballHtml(game, n, false, draw && drawnNumbers.has(n));
    }).join('');
    const specialBalls = (grid.special || []).map(n => {
      if (n == null) return `<span class="fdj-ball placeholder special">?</span>`;
      return ballHtml(game, n, true, draw && drawnSpecials.has(n));
    }).join('');

    const result = window.FdjGames.computeGridResult(game, grid, draw);

    return `
      <div class="fdj-grid-row">
        <div class="fdj-grid-balls">${numberBalls}${specialBalls}</div>
        ${gridRankHtml(game, result, draw)}
      </div>`;
  }

  // La liste est TOUJOURS présente dans le HTML (jamais omise quand repliée)
  // et .fdj-grids-collapse encapsule l'animation (grid-template-rows, voir
  // style.css) — nécessaire pour que le dépli/repli soit animable : le clic
  // sur le résumé ne re-render PAS ce bloc (voir plus bas, juste un
  // classList.toggle sur le nœud existant), donc l'élément doit déjà exister
  // dans le DOM pour que la transition CSS ait un état de départ à animer.
  // `unplayed` (2026-09-13, sur demande explicite, "ne pas simuler les gains
  // sur un tirage non joué") — grise la section ET fait passer `draw` à
  // `null` pour CE bloc uniquement (voir appelant, rerender ci-dessous) :
  // `gridRowHtml`/`computeGridResult` (fdj-games.js, INCHANGÉE) traitent déjà
  // `draw === null` comme "aucun tirage" (repli "—", aucune bille en
  // surbrillance) — réutilise ce chemin existant tel quel plutôt que
  // d'ajouter une 2e façon de dire "rien à comparer".
  function gridsBlockHtml(game, grids, draw, expanded, unplayed) {
    if (!grids.length) {
      return `<div class="fdj-grids-summary"><span class="fdj-empty">Aucune grille enregistrée — ajoutez-en dans Paramètres.</span></div>`;
    }

    const effectiveDraw = unplayed ? null : draw;
    return `
      <div class="fdj-grids-section ${expanded ? 'expanded' : ''} ${unplayed ? 'fdj-grids-unplayed' : ''}">
        <div class="fdj-grids-toggle" data-grids-toggle>
          <span class="fdj-grids-chevron">${expanded ? '▼' : '▶'}</span>
          <span>${grids.length} grille${grids.length > 1 ? 's' : ''} enregistrée${grids.length > 1 ? 's' : ''}</span>
        </div>
        <div class="fdj-grids-collapse">
          <div class="fdj-grids-list">${grids.map(grid => gridRowHtml(game, grid, effectiveDraw)).join('')}</div>
        </div>
      </div>`;
  }

  function codesBlockHtml(game, codes, winningCodes, codesStale) {
    const userCodes = codes.filter(c => c);

    const winningRefBlock = winningCodes && winningCodes.length
      ? `
        <div class="fdj-winning-codes">
          <span class="fdj-draw-label">Code${winningCodes.length > 1 ? 's' : ''} tiré${winningCodes.length > 1 ? 's' : ''}${codesStale ? ' — dernier connu' : ''}</span>
          <div class="fdj-draw-balls">${winningCodes.map(c => `<span class="fdj-code-pill">${c}</span>`).join('')}</div>
        </div>`
      : `<span class="fdj-empty">Code${game.key === 'loto' ? 's' : ''} gagnant indisponible pour le moment.</span>`;

    let indicator = '';
    if (!userCodes.length) {
      indicator = `<span class="fdj-empty">Aucun code enregistré.</span>`;
    } else if (winningCodes && winningCodes.length) {
      const winningSet = new Set(winningCodes.map(normalizeCode));
      const hasMatch = userCodes.some(code => winningSet.has(normalizeCode(code)));
      indicator = hasMatch
        ? `<span class="fdj-code-indicator win">🟢 Code gagnant détecté !</span>`
        : `<span class="fdj-code-indicator lose">🔴 Aucun code gagnant</span>`;
    }

    return `
      <div class="fdj-codes-block">
        <span class="fdj-draw-label">${game.codesLabel}</span>
        ${winningRefBlock}
        ${indicator}
      </div>`;
  }

  function winningCodesForGame(gameKey, codes) {
    if (!codes) return null;
    return gameKey === 'loto' ? (codes.loto || []) : (codes.euromillions ? [codes.euromillions] : []);
  }

  function makeFdjModule(gameKey) {
    const game = window.FdjGames.GAMES[gameKey];
    const privacyStorageKey = `${FDJ_PRIVACY_PREFIX}${gameKey}`;

    return {
      async render(container, config, _google, setBadge) {
        let privacy = localStorage.getItem(privacyStorageKey) === '1';
        let gridsExpanded = false; // repliée par défaut, voir CONTEXT.md
        let draw = null, stale = false, winningCodes = null, codesStale = false;
        let noMatchForDays = false; // 2026-09-13, sur demande explicite — voir drawBlockHtml
        // "Ne pas simuler les gains sur un tirage non joué" (2026-09-13, sur
        // demande explicite) — TOUJOURS `true` par défaut (avant le tout
        // 1er fetch, et si l'utilisateur n'a jamais configuré playDays,
        // "comportement inchangé" demandé explicitement au point 1).
        let isPlayedDraw = true;

        function rerender() {
          const grids = Array.isArray(config?.grids) ? config.grids : [];
          const codes = Array.isArray(config?.codes) ? config.codes : [];
          const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          const next = nextDrawInfo(game);
          // Avertissement rouge sous le tirage (2026-09-13, sur demande
          // explicite) — UNIQUEMENT si un tirage est réellement affiché mais
          // ne correspond pas à un jour joué (si `!draw`, l'autre message
          // "Résultats indisponibles"/"Aucun tirage disponible..." de
          // drawBlockHtml couvre déjà le cas, jamais les deux à la fois).
          const unplayedWarningHtml = (draw && !isPlayedDraw)
            ? `<div class="fdj-unplayed-warning">⚠️ Vous n'avez pas joué sur ce tirage</div>`
            : '';

          container.innerHTML = `
            <div class="fdj-module ${privacy ? 'fdj-privacy-on' : ''}">
              <div class="fdj-header">
                <span class="fdj-game-next">${next}</span>
                <button class="etf-privacy-btn" title="${privacy ? 'Afficher les grilles' : 'Masquer les grilles'}">${privacyIconHtml(privacy)}</button>
              </div>
              <div class="fdj-game-body">
                ${drawBlockHtml(game, draw, stale, noMatchForDays)}
                ${unplayedWarningHtml}
                ${gridsBlockHtml(game, grids, draw, gridsExpanded, draw && !isPlayedDraw)}
                ${game.hasCodes ? codesBlockHtml(game, codes, winningCodes, codesStale) : ''}
              </div>
              <div class="etf-footer">
                <span class="etf-updated">Mis à jour à ${now}</span>
                <button class="etf-refresh-btn">⟳ Rafraîchir</button>
              </div>
            </div>`;
        }

        async function fetchAndRender() {
          setBadge('…');
          noMatchForDays = false;

          // Sélecteur de jour(s) de tirage joués (2026-09-13, sur demande
          // explicite) — "par défaut, tous les jours cochés, comportement
          // actuel conservé" : tant que `playDays` couvre TOUS les jours de
          // tirage du jeu, on garde le chemin d'origine INCHANGÉ
          // (fetchAndNormalizeDraw, 1 seul fetch léger via la page
          // d'accueil). Le chemin par jours filtrés (CSV + plusieurs lignes)
          // ne s'active QUE si l'utilisateur a réellement restreint la
          // sélection à un sous-ensemble.
          const playDays = Array.isArray(config?.playDays) && config.playDays.length
            ? config.playDays
            : game.drawDays;
          const allDaysSelected = game.drawDays.every((d) => playDays.includes(d));

          try {
            if (allDaysSelected) {
              draw = await fetchAndNormalizeDraw(game);
            } else {
              const rows = await window.matin.fdj.fetchRecentDraws(game.key, FDJ_RECENT_DRAWS_COUNT);
              const recentDraws = rows.map((r) => window.FdjGames.normalizeDrawRow(game, r)).filter(Boolean);
              draw = getLastPlayedDraw(recentDraws, playDays);
              if (!draw) noMatchForDays = true; // fetch réussi, mais aucun tirage récent ne tombe un jour sélectionné
            }
            // Ne cache QUE si un vrai tirage a été trouvé — un `noMatchForDays`
            // ne doit jamais écraser un bon tirage déjà en cache (ex. si le
            // fetch retombe sur `allDaysSelected` un autre jour) avec `null`.
            if (draw) saveCache(game.key, draw);
            stale = false;
          } catch (err) {
            console.warn(`[FDJ ${game.key}] Résultats indisponibles`, err);
            const cached = loadCache(game.key);
            if (cached?.draw) { draw = cached.draw; stale = true; }
            else { draw = null; stale = false; }
          }

          // Filet de sécurité (2026-09-13, sur demande explicite, "ne pas
          // simuler les gains sur un tirage non joué") — RE-vérifié ici,
          // après TOUS les chemins ci-dessus (y compris le repli sur cache
          // après échec réseau, voir drawIsOnPlayedDay) plutôt que supposé
          // acquis simplement parce que `getLastPlayedDraw` l'a déjà filtré :
          // un tirage remonté du cache peut dater d'avant que `playDays` ne
          // soit restreint.
          isPlayedDraw = drawIsOnPlayedDay(draw, playDays);

          if (game.hasCodes) {
            try {
              const codes = await window.matin.fdj.fetchWinningCodes();
              saveCodesCache(codes);
              winningCodes = winningCodesForGame(game.key, codes);
              codesStale = false;
            } catch (err) {
              console.warn(`[FDJ ${game.key}] Codes gagnants indisponibles`, err);
              const cached = loadCodesCache();
              if (cached?.codes) { winningCodes = winningCodesForGame(game.key, cached.codes); codesStale = true; }
              else { winningCodes = null; codesStale = false; }
            }
          }

          rerender();
          setBadge(!draw || stale || codesStale ? '⚠' : '');
        }

        container.addEventListener('click', (e) => {
          if (e.target.closest('[data-grids-toggle]')) {
            gridsExpanded = !gridsExpanded;
            // Bascule ciblée (classList.toggle sur le nœud existant) plutôt
            // qu'un rerender() complet : un rerender() remplace tout le
            // sous-arbre via innerHTML, ce qui recrée .fdj-grids-section à
            // neuf avec sa classe finale déjà posée — sans état de départ,
            // la transition CSS (grid-template-rows, voir style.css) ne peut
            // pas s'animer et le dépli/repli deviendrait instantané.
            const section = container.querySelector('.fdj-grids-section');
            const chevron = container.querySelector('.fdj-grids-chevron');
            if (section) section.classList.toggle('expanded', gridsExpanded);
            if (chevron) chevron.textContent = gridsExpanded ? '▼' : '▶';
            return;
          }
          if (e.target.closest('.etf-privacy-btn')) {
            privacy = !privacy;
            localStorage.setItem(privacyStorageKey, privacy ? '1' : '0');
            rerender();
            return;
          }
          if (e.target.closest('.etf-refresh-btn')) {
            fetchAndRender();
          }
        });

        container.innerHTML = `<div class="loading-spinner" style="margin:20px auto;width:18px;height:18px"></div>`;
        await fetchAndRender();

        setInterval(() => {
          fetchAndRender().catch(err => console.error(`[FDJ ${game.key}] Erreur auto-refresh`, err));
        }, FDJ_REFRESH_MS);
      },
    };
  }

  return { makeFdjModule };
})();
