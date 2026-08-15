# Matin!* for Windows

Dashboard personnel du matin — Electron + Windows Store.

## Démarrage rapide

```bash
# 1. Installer les dépendances
npm install

# 2. Lancer en mode développement
npm run dev

# 3. Builder pour Windows Store (MSIX)
npm run build:msix
```

## Structure

```
matin-windows/
├── main/
│   ├── main.js          # Process principal Electron
│   └── preload.js       # Bridge sécurisé IPC
├── renderer/
│   ├── index.html       # Dashboard principal
│   ├── config.html      # Fenêtre de configuration
│   ├── dashboard.js     # Moteur de modules
│   ├── config.js        # Logique config
│   ├── assets/
│   │   └── style.css    # Design system complet
│   └── modules/
│       ├── weather.js   # Météo (Open-Meteo)
│       ├── rss.js       # Actualités RSS
│       ├── calendar.js  # Google Calendar
│       ├── etf.js       # ETF / Bourse
│       ├── gmail.js     # Gmail
│       ├── ol.js        # OL Football
│       ├── fdj.js       # FDJ
│       └── crypto.js    # Crypto (CoinGecko)
└── package.json
```

## Ajouter un module

1. Créer `renderer/modules/monmodule.js` avec :
```js
window.MatinModules = window.MatinModules || {};
window.MatinModules.monmodule = {
  async render(container, config, googleData, setBadge) {
    // Ton code ici
    setBadge('texte court');
    container.innerHTML = `...`;
  }
};
```

2. Ajouter le `<script>` dans `index.html`
3. Enregistrer dans `dashboard.js` → `MODULE_REGISTRY`
4. Ajouter la config par défaut dans `main.js` → `store defaults`
5. Ajouter la meta dans `config.js` → `MODULE_META`

## TODO
- [ ] Google OAuth PKCE flow (auth/google-oauth.js)
- [ ] Icône app (renderer/assets/icons/icon.png + icon.ico)
- [ ] Client ID Google Console
- [ ] Signature MSIX pour le Store
