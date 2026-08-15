/**
 * MATIN!* — Authentification Google (flux "loopback" RFC 8252)
 *
 * Ouvre l'URL de consentement dans le navigateur système, puis récupère le
 * code d'autorisation via un petit serveur HTTP local écoutant sur
 * 127.0.0.1 — aucune saisie manuelle de code n'est nécessaire.
 */
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { shell } = require('electron');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

// Renseignés dans .env (voir Google Cloud Console, type de client : "Application de bureau").
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Doit correspondre exactement à un URI de redirection autorisé du client OAuth.
const REDIRECT_PORT = 42813;
const REDIRECT_PATH = '/oauth/callback';
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}${REDIRECT_PATH}`;

const SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/gmail.readonly',
  // Module Tâches Google (2026-08-06) — pas *.readonly : le module coche/
  // ajoute/supprime des tâches, donc écriture nécessaire.
  'https://www.googleapis.com/auth/tasks',
  // Module Anniversaires (2026-08-07, People API) — lecture seule des
  // contacts. IMPORTANT : un compte déjà connecté AVANT cet ajout n'a pas ce
  // scope sur son token existant (un rafraîchissement de token ne peut pas
  // en ajouter un) — reconnexion manuelle nécessaire depuis Paramètres,
  // même situation que l'ajout du scope Tasks juste au-dessus.
  'https://www.googleapis.com/auth/contacts.readonly',
  // Module YouTube Notifications (2026-08-15) — lecture seule (résolution de
  // chaîne via l'API Search, voir main.js). Même mise en garde que les 2
  // scopes ci-dessus : un compte déjà connecté avant cet ajout devra se
  // reconnecter depuis Paramètres pour l'obtenir. Nécessite l'activation de
  // "YouTube Data API v3" dans le MÊME projet Google Cloud Console que
  // Calendar/Gmail (APIs & Services → Library) — pas automatisable depuis ce
  // code, action ponctuelle côté utilisateur.
  'https://www.googleapis.com/auth/youtube.readonly',
].join(' ');

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

async function exchangeCodeForTokens(code, codeVerifier) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Échec de l\'échange du code');
  return data;
}

async function fetchUserEmail(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.email || null;
}

/**
 * Échange un refresh_token contre un nouvel access_token. Google ne renvoie
 * pas de nouveau refresh_token ici — l'appelant doit conserver l'ancien.
 */
async function refreshAccessToken(refreshToken) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants dans .env');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Échec du rafraîchissement du token');

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// Tentative en cours : évite de relancer un 2e serveur sur le même port
// (EADDRINUSE) si l'utilisateur clique plusieurs fois avant d'avoir terminé
// le consentement dans le navigateur — on rouvre simplement l'onglet.
let activeFlow = null;

/**
 * Lance le flux OAuth complet et résout avec { accessToken, refreshToken, expiresAt, email }.
 */
function runGoogleAuthFlow() {
  if (activeFlow) {
    shell.openExternal(activeFlow.authUrl);
    return activeFlow.promise;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return Promise.reject(new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants dans .env'));
  }

  let authUrl;

  const promise = new Promise((resolve, reject) => {
    const state = base64url(crypto.randomBytes(16));
    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
    authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
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
        const tokens = await exchangeCodeForTokens(code, codeVerifier);
        const email = await fetchUserEmail(tokens.access_token);

        res.writeHead(200, { 'Content-Type': 'text/html' })
          .end(renderPage('Connecté !', 'Vous pouvez fermer cet onglet et revenir à Matin.', true));

        finish(null, {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || null,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          email,
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

module.exports = { runGoogleAuthFlow, refreshAccessToken };
