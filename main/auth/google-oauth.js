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

// Port de secours ajouté le 2026-08-16 (sur demande explicite, bug rapporté :
// ERR_CONNECTION_REFUSED au retour de Google, symptôme typique d'un serveur
// de callback qui n'écoute plus/jamais sur le port attendu — voir
// startCallbackServer ci-dessous). 42813 reste essayé EN PREMIER (comporte-
// ment inchangé dans le cas normal), 42814 uniquement si 42813 est occupé
// (EADDRINUSE). IMPORTANT — ce fichier ne peut PAS modifier la configuration
// Google Cloud Console à distance : chaque port de cette liste doit avoir
// son URI de redirection complète enregistrée EXACTEMENT dans le client
// OAuth (Google Cloud Console → APIs & Services → Identifiants → ce client
// "Application de bureau" → "URI de redirection autorisés"), sinon Google
// répond "redirect_uri_mismatch" si jamais la bascule vers 42814 survient —
// un échec différent et plus clair qu'ERR_CONNECTION_REFUSED, mais un échec
// quand même tant que ce 2e URI n'est pas ajouté côté Google. L'URI RÉELLEMENT
// utilisée est loguée à chaque tentative de connexion (voir plus bas) —
// comparez-la caractère pour caractère à ce qui est enregistré dans la
// Console : un simple / final en trop/manquant, http vs https, ou un port
// différent suffit à faire échouer l'échange de token même si le serveur
// local, lui, fonctionne parfaitement.
const REDIRECT_PORTS = [42813, 42814];
const REDIRECT_PATH = '/oauth/callback';

function redirectUriFor(port) {
  return `http://localhost:${port}${REDIRECT_PATH}`;
}

// Démarre le serveur HTTP de callback OAuth, port par port dans l'ordre de
// REDIRECT_PORTS, et s'arrête au premier qui réussit. Résout avec
// { server, port } — le port RÉELLEMENT obtenu peut différer de
// REDIRECT_PORTS[0] si celui-ci était occupé. Rejette seulement si TOUS les
// ports de la liste échouent (EADDRINUSE ou toute autre erreur de liaison,
// ex. permissions). Chaque tentative (succès, port occupé, ou autre erreur)
// est explicitement loguée — répond aux points 1/2/4 de la demande de debug.
function startCallbackServer(requestHandler) {
  return new Promise((resolve, reject) => {
    let index = 0;

    function tryNext() {
      if (index >= REDIRECT_PORTS.length) {
        const err = new Error(`Aucun port disponible parmi ${REDIRECT_PORTS.join(', ')} pour le serveur de callback OAuth`);
        console.error('[Google OAuth]', err.message);
        reject(err);
        return;
      }
      const port = REDIRECT_PORTS[index];
      index++;

      const server = http.createServer(requestHandler);

      const onError = (err) => {
        server.removeListener('error', onError);
        if (err.code === 'EADDRINUSE') {
          console.warn(`[Google OAuth] Port ${port} déjà utilisé (EADDRINUSE)` + (index < REDIRECT_PORTS.length ? ` — tentative sur le port de secours ${REDIRECT_PORTS[index]}...` : ' — plus aucun port de secours disponible.'));
          tryNext();
        } else {
          console.error(`[Google OAuth] Échec du démarrage du serveur de callback sur le port ${port} :`, err.code || err.message, err);
          reject(err);
        }
      };

      server.once('error', onError);
      // `server.listen(...)` avec callback : ce callback ne se déclenche QUE
      // si la liaison réussit RÉELLEMENT (jamais en cas d'EADDRINUSE, géré
      // par 'error' ci-dessus à la place) — c'est ce qui garantit
      // structurellement que le navigateur n'est ouvert qu'APRÈS un serveur
      // qui écoute vraiment (point 3 de la demande) : `shell.openExternal`
      // (voir runGoogleAuthFlow) n'est appelé que dans le `.then()` de la
      // Promise retournée ici, jamais avant.
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        console.log(`[Google OAuth] Serveur de callback démarré sur http://127.0.0.1:${port}${REDIRECT_PATH}`);
        resolve({ server, port });
      });
    }

    tryNext();
  });
}

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

// `redirectUri` passé en paramètre (plus une constante fixe) — doit être
// EXACTEMENT celui envoyé dans l'URL de consentement initiale (voir
// runGoogleAuthFlow), lui-même dépendant du port RÉELLEMENT obtenu par
// startCallbackServer (42813 normalement, 42814 en secours) : un URI
// différent entre les 2 appels fait échouer Google avec
// "redirect_uri_mismatch" même si les 2 valeurs semblent correctes prises
// séparément.
async function exchangeCodeForTokens(code, codeVerifier, redirectUri) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: redirectUri,
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

// Tentative en cours : évite de relancer un 2e serveur (et un 2e essai de
// port) si l'utilisateur clique plusieurs fois avant d'avoir terminé le
// consentement dans le navigateur — on rouvre simplement l'onglet, SAUF si
// le serveur de callback n'a pas encore fini de démarrer (`authUrl` encore
// `null` : voir plus bas), auquel cas on attend juste la même promesse sans
// tenter d'ouvrir une URL qui n'existe pas encore.
let activeFlow = null;

/**
 * Lance le flux OAuth complet et résout avec { accessToken, refreshToken, expiresAt, email }.
 */
function runGoogleAuthFlow() {
  if (activeFlow) {
    if (activeFlow.authUrl) shell.openExternal(activeFlow.authUrl);
    return activeFlow.promise;
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return Promise.reject(new Error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquants dans .env'));
  }

  const state = base64url(crypto.randomBytes(16));
  const codeVerifier = base64url(crypto.randomBytes(32));
  const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());

  let settled = false;
  let timeoutHandle;
  let server = null;

  const promise = new Promise((resolve, reject) => {
    const finish = (err, tokenData) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      if (server) server.close();
      activeFlow = null;
      if (err) reject(err);
      else resolve(tokenData);
    };

    // Fixé une fois le port RÉEL connu (voir .then ci-dessous) — utilisé à
    // la fois pour router la requête entrante (comparaison de `pathname`,
    // insensible au port donc sans risque même avant d'être fixé) et pour
    // l'échange de token, qui doit envoyer EXACTEMENT le même `redirect_uri`
    // que celui reçu par Google dans l'URL de consentement initiale.
    let redirectUri = redirectUriFor(REDIRECT_PORTS[0]);

    const handleCallbackRequest = async (req, res) => {
      const url = new URL(req.url, redirectUri);
      if (url.pathname !== REDIRECT_PATH) {
        res.writeHead(404).end();
        return;
      }

      const returnedState = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');

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
        const tokens = await exchangeCodeForTokens(code, codeVerifier, redirectUri);
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
    };

    startCallbackServer(handleCallbackRequest)
      .then(({ server: startedServer, port }) => {
        server = startedServer;
        redirectUri = redirectUriFor(port);
        console.log(`[Google OAuth] URI de redirection utilisée pour cette tentative (comparez-la EXACTEMENT à "URI de redirection autorisés" dans Google Cloud Console) : ${redirectUri}`);

        const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
          client_id: CLIENT_ID,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope: SCOPES,
          access_type: 'offline',
          prompt: 'consent',
          state,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        }).toString();

        // Le serveur écoute déjà RÉELLEMENT à ce stade (on est dans le
        // `.then()` de startCallbackServer, qui ne résout qu'après un
        // `listen()` réussi) — le navigateur ne peut donc jamais être ouvert
        // sur une URL de redirection que rien n'écoute encore.
        activeFlow.authUrl = authUrl;
        shell.openExternal(authUrl);

        timeoutHandle = setTimeout(() => {
          if (settled) return;
          settled = true;
          server.close();
          activeFlow = null;
          reject(new Error('Délai d\'authentification dépassé'));
        }, AUTH_TIMEOUT_MS);
      })
      .catch((err) => {
        console.error('[Google OAuth] Impossible de démarrer le serveur de callback OAuth — le navigateur ne sera pas ouvert :', err.message);
        activeFlow = null;
        reject(err);
      });
  });

  // Posé de façon SYNCHRONE ici (avant tout retour à la boucle d'événements)
  // — `authUrl: null` marque "tentative en cours, serveur pas encore prêt" :
  // un 2e appel concurrent (double-clic) attrape ce garde-fou tout de suite
  // et attend simplement la même promesse, sans risquer de démarrer un 2e
  // serveur en parallèle avant que celui-ci ait fini de se lier à son port.
  activeFlow = { promise, authUrl: null };
  return promise;
}

module.exports = { runGoogleAuthFlow, refreshAccessToken };
