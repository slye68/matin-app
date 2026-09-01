/**
 * MATIN!* — Authentification Spotify (Authorization Code + PKCE, flux "loopback")
 *
 * Même schéma que l'authentification Google (voir google-oauth.js) : ouvre
 * l'URL de consentement dans le navigateur système, récupère le code via un
 * petit serveur HTTP local — aucune saisie manuelle de code n'est nécessaire.
 *
 * Redirect URI imposé par la config de l'app Spotify (Spotify Developer
 * Dashboard) : http://127.0.0.1:42813/callback — Spotify exige désormais un
 * littéral "127.0.0.1" pour les redirections loopback (pas "localhost").
 *
 * Partage le même port que le flux Google (42813) mais un chemin différent ;
 * comme chaque serveur local ne vit que le temps du flux (fermé dès le
 * callback ou en timeout), un conflit ne peut survenir que si les deux flux
 * sont lancés en même temps avant que l'un des deux ait terminé — cas
 * marginal en pratique (connexion Google puis Spotify l'une après l'autre
 * depuis Paramètres).
 */
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { shell } = require('electron');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;

const REDIRECT_PORT = 42813;
const REDIRECT_PATH = '/callback';
const REDIRECT_URI = `http://127.0.0.1:${REDIRECT_PORT}${REDIRECT_PATH}`;

const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-recently-played',
  // Ajouté le 2026-09-01 (sur demande explicite — badge nom de playlist,
  // voir spotify.js/spotifyResolveContextLabel) : GET /playlists/{id}
  // répond 403 sans ce scope dès que la playlist en cours de lecture est
  // privée (le cas le plus courant pour une playlist personnelle) — un
  // compte déjà connecté avant cet ajout devra se déconnecter/reconnecter
  // (Paramètres → Compte Spotify) pour que ce scope soit proposé au
  // consentement, même situation que l'ajout du scope Tasks sur Google.
  'playlist-read-private',
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
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code_verifier: codeVerifier,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Échec de l\'échange du code');
  return data;
}

async function fetchProfile(accessToken) {
  const res = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return { email: data.email || null, displayName: data.display_name || null };
}

/**
 * Échange un refresh_token contre un nouvel access_token. Spotify ne renvoie
 * pas toujours un nouveau refresh_token — l'appelant doit conserver l'ancien
 * si absent de la réponse.
 */
async function refreshAccessToken(refreshToken) {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    throw new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET manquants dans .env');
  }

  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Échec du rafraîchissement du token');

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

// Tentative en cours : évite de relancer un 2e serveur sur le même port
// (EADDRINUSE) si l'utilisateur clique plusieurs fois avant d'avoir terminé
// le consentement dans le navigateur — on rouvre simplement l'onglet.
let activeFlow = null;

/**
 * Lance le flux OAuth complet et résout avec
 * { accessToken, refreshToken, expiresAt, email, displayName }.
 */
function runSpotifyAuthFlow() {
  if (activeFlow) {
    shell.openExternal(activeFlow.authUrl);
    return activeFlow.promise;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return Promise.reject(new Error('SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET manquants dans .env'));
  }

  let authUrl;

  const promise = new Promise((resolve, reject) => {
    const state = base64url(crypto.randomBytes(16));
    const codeVerifier = base64url(crypto.randomBytes(32));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

    authUrl = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
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
        const profile = await fetchProfile(tokens.access_token);

        res.writeHead(200, { 'Content-Type': 'text/html' })
          .end(renderPage('Connecté !', 'Vous pouvez fermer cet onglet et revenir à Matin.', true));

        finish(null, {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token || null,
          expiresAt: Date.now() + tokens.expires_in * 1000,
          email: profile?.email || null,
          displayName: profile?.displayName || null,
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

module.exports = { runSpotifyAuthFlow, refreshAccessToken };
