/**
 * Module Colis — suivi de paquets par scraping direct des pages de suivi
 * publiques des transporteurs (2026-08-05, sur demande explicite — remplace
 * 17TRACK : plus de clé API, plus de compte, plus de quota d'enregistrement).
 * Transporteur détecté automatiquement depuis le format du numéro de suivi,
 * y compris le format international UPU S10 (2 lettres + 9 chiffres + 2
 * lettres) routé vers Colissimo (voir parcels-carriers.js, partagé avec
 * config.js). Repli sur La Poste (parcelsFetchItemStatus) si aucun format
 * connu ne matche — elle gère en pratique un large éventail d'envois,
 * y compris internationaux (2026-08-05, sur demande explicite) ; le
 * transporteur n'est affiché comme identifié que si ce repli aboutit
 * réellement à un statut, jamais s'il échoue aussi.
 *
 * Cascade de fetch — jina.ai Reader (rendu JS, nécessaire : les 4 pages de
 * suivi ciblées sont des applications JS qui n'affichent aucune donnée utile
 * dans leur HTML brut) → allorigins.win → fetch direct — même principe que
 * le module ETF (voir etf.js), gardés comme repli même si peu susceptibles
 * de trouver un statut sur des pages qui exigent du JS pour s'hydrater.
 * Toutes les requêtes passent par window.matin.rss.fetchFeed (proxy générique
 * côté process main, aucune restriction CORS là-bas).
 *
 * AVERTISSEMENT : non testé en conditions réelles (aucun numéro de suivi
 * réel disponible pendant le développement) — le motif d'extraction du
 * statut (parcelsExtractStatus) est un scan de mots-clés volontairement
 * générique et multilingue (FR + EN, UPS/DHL pouvant répondre en anglais
 * selon la géolocalisation détectée côté transporteur) plutôt qu'un ciblage
 * précis d'un sélecteur CSS par transporteur, qui n'aurait pas pu être
 * vérifié contre une vraie page. À vérifier en priorité au premier usage
 * réel (voir CONTEXT.md) : si le statut affiché semble faux ou reste
 * "Statut introuvable sur la page", inspecter le texte brut renvoyé (loggué
 * en console) pour ajuster les motifs.
 */
window.MatinModules = window.MatinModules || {};

const PARCELS_REFRESH_MS = 60 * 60 * 1000;

// Vocabulaire de statut, du plus définitif (livré) au plus incertain — le
// premier motif trouvé dans le texte l'emporte. FR en premier (4 des 4 pages
// ciblées sont des versions françaises), EN en repli pour UPS/DHL.
const PARCELS_STATUS_PATTERNS = [
  { color: 'red',    label: 'Problème',
    re: /(colis perdu|non livrable|échec de la livraison|non distribuable|retourné à l'expéditeur|delivery exception|undeliverable|return to sender)/i },
  { color: 'green',  label: 'Livré',
    re: /(colis livré|a été livré|livraison effectuée|remis (?:au|à la) destinataire|delivered)/i },
  { color: 'yellow', label: 'En cours de livraison',
    re: /(en cours de livraison|out for delivery)/i },
  { color: 'yellow', label: 'En transit',
    re: /(en cours d'acheminement|pris en charge|expédié|colis scanné|in transit|arrived at|departed|shipment information received)/i },
];

const PARCELS_NOT_FOUND_RE = /(numéro de suivi invalide|colis introuvable|aucune information (?:de suivi )?disponible|tracking number.{0,20}(?:not found|invalid)|no tracking information)/i;

const PARCELS_ETA_RE = /(?:livraison prévue|prévu(?:e)? le|estimated delivery)[^\d]{0,20}(\d{1,2}[/\-.]\d{1,2}(?:[/\-.]\d{2,4})?)/i;

function parcelsStripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parcelsExtractStatus(text) {
  for (const p of PARCELS_STATUS_PATTERNS) {
    const m = text.match(p.re);
    if (!m) continue;
    // Extrait ~40 caractères autour du motif comme descriptif — best-effort,
    // le texte source (markdown jina.ai ou HTML nettoyé) n'a pas de structure
    // de "ligne d'évènement" fiable à cibler précisément.
    const idx = m.index;
    const snippet = text.slice(Math.max(idx - 10, 0), idx + m[0].length + 40).trim();
    return { color: p.color, label: p.label, lastEventDesc: snippet };
  }
  return null;
}

function parcelsExtractEta(text) {
  const m = text.match(PARCELS_ETA_RE);
  return m ? m[1] : null;
}

// Cascade jina.ai Reader → allorigins.win → fetch direct — voir en-tête du
// fichier. Logue systématiquement la longueur du texte reçu par la méthode
// qui a réussi, pour pouvoir vérifier la source en cas de doute.
// Longueur du bloc affiché par log — assez pour repérer un motif de statut
// à l'œil, pas assez pour noyer la console sur une page de plusieurs Ko.
const PARCELS_LOG_PREVIEW_LEN = 500;

async function parcelsFetchTrackingText(targetUrl) {
  console.log(`[Colis] URL de suivi utilisée : ${targetUrl}`);

  const attempts = [
    { method: 'jina.ai', url: `https://r.jina.ai/${targetUrl}` },
    { method: 'allorigins', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}` },
    { method: 'direct', url: targetUrl },
  ];

  let lastErr = new Error('Aucune méthode de suivi disponible');
  for (const { method, url } of attempts) {
    try {
      const raw = await window.matin.rss.fetchFeed(url);
      const text = method === 'jina.ai' ? raw : parcelsStripHtml(raw);
      console.log(`[Colis] ${targetUrl} via ${method} — ${text.length} caractères de texte exploitable`);
      console.log(`[Colis] Réponse brute (${method}, ${PARCELS_LOG_PREVIEW_LEN} premiers caractères) :`, text.slice(0, PARCELS_LOG_PREVIEW_LEN));
      return text;
    } catch (err) {
      console.warn(`[Colis] ${targetUrl} via ${method} échoué`, err.message);
      lastErr = err;
    }
  }
  throw lastErr;
}

// Repli : si aucun format connu ne matche, on tente quand même La Poste
// (DEFAULT_FALLBACK_CARRIER) avant d'abandonner — elle gère en pratique un
// large éventail de formats, y compris des envois internationaux confiés à
// d'autres opérateurs postaux mais distribués en France (2026-08-05, sur
// demande explicite). `carrier` n'est renvoyé comme identifié que si ce
// repli a effectivement abouti à un statut exploitable ; s'il échoue aussi,
// on retombe sur "transporteur non reconnu" plutôt que d'afficher un
// transporteur qu'on n'a en réalité fait que deviner sans succès.
async function parcelsFetchItemStatus(item) {
  const detected = window.ParcelsCarriers.detectCarrier(item.trackingNumber);
  const isFallback = !detected;
  const carrier = detected || window.ParcelsCarriers.DEFAULT_FALLBACK_CARRIER;
  console.log(`[Colis] Détection "${item.trackingNumber}" → ${detected ? detected : `non détecté, repli sur ${carrier}`}`);

  const targetUrl = window.ParcelsCarriers.buildTrackingUrl(carrier, item.trackingNumber);
  try {
    const text = await parcelsFetchTrackingText(targetUrl);
    if (PARCELS_NOT_FOUND_RE.test(text)) {
      return { carrier: isFallback ? null : carrier, statusInfo: null, error: isFallback ? 'Transporteur non reconnu' : 'Numéro de suivi introuvable' };
    }

    const status = parcelsExtractStatus(text);
    if (!status) {
      return { carrier: isFallback ? null : carrier, statusInfo: null, error: isFallback ? 'Transporteur non reconnu' : 'Statut introuvable sur la page' };
    }

    return { carrier, statusInfo: { ...status, eta: parcelsExtractEta(text) }, error: null };
  } catch (err) {
    console.warn(`[Colis] Statut indisponible pour ${item.trackingNumber} (${carrier}${isFallback ? ', repli La Poste' : ''})`, err);
    return { carrier: isFallback ? null : carrier, statusInfo: null, error: isFallback ? 'Transporteur non reconnu' : 'Suivi indisponible' };
  }
}

const PARCELS_COLOR_EMOJI = { green: '🟢', yellow: '🟡', red: '🔴' };

function parcelsRowHtml({ item, carrier, statusInfo, error }) {
  if (error || !statusInfo) {
    return `
      <div class="parcels-row-display">
        <div class="parcels-row-main">
          <span class="parcels-row-label">${item.label || item.trackingNumber}</span>
          <span class="parcels-row-carrier">${carrier || '?'} · ${item.trackingNumber}</span>
          <span class="module-error">${error || 'Statut indisponible'}</span>
        </div>
      </div>`;
  }

  return `
    <div class="parcels-row-display">
      <div class="parcels-row-main">
        <span class="parcels-row-label">${item.label || item.trackingNumber}</span>
        <span class="parcels-row-carrier">${carrier} · ${item.trackingNumber}</span>
        <span class="parcels-row-event">${statusInfo.lastEventDesc}</span>
        ${statusInfo.eta ? `<span class="parcels-row-eta">Livraison estimée : ${statusInfo.eta}</span>` : ''}
      </div>
      <span class="parcels-status-badge parcels-${statusInfo.color}">${PARCELS_COLOR_EMOJI[statusInfo.color]} ${statusInfo.label}</span>
    </div>`;
}

window.MatinModules.parcels = {
  async render(container, config, _google, setBadge) {
    const items = (config?.items || []).filter(i => i.trackingNumber);
    if (!items.length) {
      container.innerHTML = `<div class="module-empty">Ajoutez un colis à suivre dans Paramètres.</div>`;
      setBadge('—');
      return;
    }

    async function loadAndRender() {
      setBadge('…');
      const rows = await Promise.all(items.map(async (item) => {
        const result = await parcelsFetchItemStatus(item);
        return { item, ...result };
      }));

      container.innerHTML = `<div class="parcels-module"><div class="parcels-list-display">${rows.map(parcelsRowHtml).join('')}</div></div>`;

      const issues = rows.filter(r => r.error || r.statusInfo?.color === 'red').length;
      setBadge(issues ? `⚠ ${issues}` : `${items.length}`);
    }

    container.innerHTML = `<div class="loading-spinner" style="margin:20px auto;width:18px;height:18px"></div>`;
    await loadAndRender();

    setInterval(() => {
      loadAndRender().catch(err => console.error('[Colis] Erreur auto-refresh', err));
    }, PARCELS_REFRESH_MS);
  },
};
