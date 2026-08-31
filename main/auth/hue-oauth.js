/**
 * MATIN!* — Authentification Philips Hue SANS pont (2026-08-31, sur demande
 * explicite — support des ampoules Hue de nouvelle génération qui se
 * connectent directement au compte cloud Hue, sans passeau/bridge local).
 *
 * Même flux "loopback" RFC 8252 que Google/Spotify (voir google-oauth.js/
 * spotify-oauth.js) : ouvre l'URL de consentement dans le navigateur système,
 * récupère le code via un petit serveur HTTP local — aucune saisie manuelle
 * de code nécessaire.
 *
 * DIFFÉRENCE avec Google/Spotify : `clientId`/`clientSecret` ne viennent PAS
 * du `.env` de cette app (Hue n'accorde pas d'application "partenaire" au
 * grand public — chaque utilisateur doit créer SA PROPRE application sur
 * developers.meethue.com, voir renderer/config.js renderHueCloudConfigSection)
 * — ces 2 valeurs sont donc passées en paramètres à `runHueAuthFlow`,
 * saisies par l'utilisateur en Paramètres → Maison → Philips Hue.
 *
 * Port de redirection FIXE demandé explicitement : 127.0.0.1:42815/callback
 * — différent de Google/Spotify (42813/42814) pour ne jamais entrer en
 * conflit si plusieurs flux OAuth étaient lancés au même instant.
 *
 * AVERTISSEMENT : non vérifié en conditions réelles (aucun compte
 * developers.meethue.com/application Hue disponible pendant ce
 * développement) — l'échange de code contre un token suit la convention
 * OAuth2 la plus répandue (Basic Auth client_id:client_secret à l'échange),
 * à ajuster au premier usage réel si Hue attend un format différent (voir
 * CONTEXT.md). Les scopes ("basic", "clip:all") et le format exact de l'URL
 * d'autorisation sont ceux demandés explicitement ; à confirmer contre la
 * documentation Hue réelle si l'autorisation échoue.
 */
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');

const REDIRECT_PORT = 42815;
const REDIRECT_PATH = '/callback';
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}${REDIRECT_PATH}`;

// Demandés explicitement — séparés par un espace, convention standard OAuth2
// pour une liste de scopes (le "basic, clip:all" de la demande, avec virgule,
// est traité comme la liste humaine des 2 scopes à inclure, pas le séparateur
// littéral à envoyer).
const SCOPES = 'basic clip:all';

const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

function base64url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function renderPage(title, message, ok) {
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>${title}</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f1117; color: #e8eaf0;
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .box { text-align: center; }
  h1 { font-size: 20px; color: ${ok ? '#34d399' : '#f87171'}; }
  p { color: #8b95a8; font-size: 14px; }
</style></head>
<body><div class="box"><h1>${title}</h1><p>${message}</p></div></body></html>`;
}

// Convention OAuth2 la plus répandue pour un client confidentiel (secret
// connu) : `Authorization: Basic base64(client_id:client_secret)` +
// `grant_type`/`code`/`redirect_uri` en corps `application/x-www-form-
// urlencoded` — non vérifié contre la documentation Hue réelle (voir
// avertissement d'en-tête).
async function exchangeCodeForTokens(code, clientId, clientSecret) {
  const res = await fetch('https://api.meethue.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Échec de l\'échange du code');
  return data;
}

/**
 * Rafraîchit un access_token expiré à partir du refresh_token — même
 * convention Basic Auth que l'échange initial.
 */
async function refreshHueAccessToken(refreshToken, clientId, clientSecret) {
  const res = await fetch('https://api.meethue.com/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Échec du rafraîchissement du token');
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

// Tentative en cours : évite de relancer un 2e serveur sur le même port
// (EADDRINUSE) si l'utilisateur clique plusieurs fois avant d'avoir terminé
// le consentement dans le navigateur — on rouvre simplement l'onglet (même
// principe que google-oauth.js/spotify-oauth.js).
let activeFlow = null;

/**
 * Lance le flux OAuth complet et résout avec
 * { accessToken, refreshToken, expiresAt }. `clientId`/`clientSecret`
 * saisis par l'utilisateur (voir en-tête de fichier), jamais depuis `.env`.
 */
function runHueAuthFlow(clientId, clientSecret) {
  if (!clientId || !clientSecret) {
    return Promise.reject(new Error('Client ID / Client Secret Hue manquants — renseignez-les avant de vous connecter.'));
  }
  if (activeFlow) {
    shell.openExternal(activeFlow.authUrl);
    return activeFlow.promise;
  }

  let authUrl;

  const promise = new Promise((resolve, reject) => {
    const state = base64url(crypto.randomBytes(16));

    authUrl = 'https://api.meethue.com/oauth2/auth?' + new URLSearchParams({
      clientid: clientId,
      response_type: 'code',
      state,
      scope: SCOPES,
      redirect_uri: REDIRECT_URI,
    }).toString();

    let settled = false;
    let timeoutHandle;

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url, REDIRECT_URI);
      if (url.pathname !== REDIRECT_PATH) {
        res.writeHead(404).end();
        return;
      }

      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');

      const finish = (err, tokenData) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        server.close();
        activeFlow = null;
        if (err) reject(err);
        else resolve(tokenData);
      };

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
          .end(renderPage('Connexion annulée', 'Vous pouvez fermer cet onglet.', false));
        finish(new Error(`Autorisation refusée : ${error}`));
        return;
      }

      if (!code || returnedState !== state) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
          .end(renderPage('Erreur', 'Requête invalide. Vous pouvez fermer cet onglet.', false));
        finish(new Error('Réponse OAuth invalide (state/code manquant)'));
        return;
      }

      try {
        const tokens = await exchangeCodeForTokens(code, clientId, clientSecret);
        res.writeHead(200, { 'Content-Type': 'text/html' })
          .end(renderPage('Connecté !', 'Vous pouvez fermer cet onglet et revenir à Matin.', true));

        finish(null, {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || null,
          expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
        });
      } catch (err) {
        res.writeHead(500, { 'Content-Type': 'text/html' })
          .end(renderPage('Erreur', 'Échec de la connexion. Vous pouvez fermer cet onglet.', false));
        finish(err);
      }
    });

    server.on('error', (err) => {
      if (settled) return;
      settled = true;
      activeFlow = null;
      clearTimeout(timeoutHandle);
      reject(err);
    });

    server.listen(REDIRECT_PORT, '127.0.0.1', () => {
      shell.openExternal(authUrl);
    });

    timeoutHandle = setTimeout(() => {
      if (settled) return;
      settled = true;
      server.close();
      activeFlow = null;
      reject(new Error('Délai d\'authentification dépassé'));
    }, AUTH_TIMEOUT_MS);
  });

  activeFlow = { promise, authUrl };
  return promise;
}

module.exports = { runHueAuthFlow, refreshHueAccessToken };
