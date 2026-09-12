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

  function drawBlockHtml(game, draw, stale) {
    if (!draw) {
      return `<div class="fdj-draw-block"><span class="fdj-empty">Résultats indisponibles</span></div>`;
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

  function gridRankHtml(game, result, draw) {
    if (!draw) return `<span class="fdj-grid-rank miss">—</span>`;
    if (!result.rank) return `<span class="fdj-grid-rank miss">Aucun gain</span>`;

    const r = result.rank;
    const amount = r.fixedAmount != null
      ? `${r.fixedAmount.toFixed(2).replace('.', ',')} €`
      : (r.label || 'cagnotte partagée');
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
  function gridsBlockHtml(game, grids, draw, expanded) {
    if (!grids.length) {
      return `<div class="fdj-grids-summary"><span class="fdj-empty">Aucune grille enregistrée — ajoutez-en dans Paramètres.</span></div>`;
    }

    return `
      <div class="fdj-grids-section ${expanded ? 'expanded' : ''}">
        <div class="fdj-grids-toggle" data-grids-toggle>
          <span class="fdj-grids-chevron">${expanded ? '▼' : '▶'}</span>
          <span>${grids.length} grille${grids.length > 1 ? 's' : ''} enregistrée${grids.length > 1 ? 's' : ''}</span>
        </div>
        <div class="fdj-grids-collapse">
          <div class="fdj-grids-list">${grids.map(grid => gridRowHtml(game, grid, draw)).join('')}</div>
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

        function rerender() {
          const grids = Array.isArray(config?.grids) ? config.grids : [];
          const codes = Array.isArray(config?.codes) ? config.codes : [];
          const now = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
          const next = nextDrawInfo(game);

          container.innerHTML = `
            <div class="fdj-module ${privacy ? 'fdj-privacy-on' : ''}">
              <div class="fdj-header">
                <span class="fdj-game-next">${next}</span>
                <button class="etf-privacy-btn" title="${privacy ? 'Afficher les grilles' : 'Masquer les grilles'}">${privacyIconHtml(privacy)}</button>
              </div>
              <div class="fdj-game-body">
                ${drawBlockHtml(game, draw, stale)}
                ${gridsBlockHtml(game, grids, draw, gridsExpanded)}
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

          try {
            draw = await fetchAndNormalizeDraw(game);
            saveCache(game.key, draw);
            stale = false;
          } catch (err) {
            console.warn(`[FDJ ${game.key}] Résultats indisponibles`, err);
            const cached = loadCache(game.key);
            if (cached?.draw) { draw = cached.draw; stale = true; }
            else { draw = null; stale = false; }
          }

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
