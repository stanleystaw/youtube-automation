# youtube-automation

Pipeline **Node.js + GitHub Actions** : chacun l’installe sur **son** compte Google et **sa** chaîne YouTube.

| Flux | Quand (défaut) | Destination |
|---|---|---|
| 1 actu mondiale | 19h–20h (fuseau de `settings.json`) | YouTube seulement |
| 2 conseils / jour | 12h20 et 16h20 | YouTube + dossier Drive **Conseils** |

Aucune clé API n’est dans le code. Les secrets vivent dans **GitHub Actions** (ou un `.env` local gitignoré).

---

## Démarrer (fork)

1. **Fork** ce dépôt (ou duplique-le).
2. Remplace `assets/presenter.jpg` par **ta** présentatrice si tu veux.
3. Adapte `config/settings.json` (`timezone`, `newsHours`, `quotes.perDay`, `language`…).
4. Adapte les crons UTC dans `.github/workflows/daily.yml` à ton fuseau.
5. Crée les **secrets** GitHub (tableau plus bas).
6. Autorise YouTube puis Drive (`npm run auth` en local, type **Application de bureau**).
7. Onglet **Actions** → autorise les workflows → **Run workflow**.

---

## Secrets GitHub

Repo → **Settings → Secrets and variables → Actions** :

| Secret | Obligatoire |
|---|---|
| `MAGICLIGHT_API_KEY` | oui |
| `GEMINI_API_KEY` | oui (actu + conseils) |
| `GOOGLE_CLIENT_ID` | oui |
| `GOOGLE_CLIENT_SECRET` | oui |
| `GOOGLE_REFRESH_TOKEN_YOUTUBE` | oui |
| `GOOGLE_REFRESH_TOKEN_DRIVE` | oui |
| `YOUTUBE_PRIVACY` | non (`public` / `unlisted` / `private`) |

Ne commite **jamais** `.env`, un JSON client OAuth, ni un refresh token.

---

## Google OAuth (une fois)

1. [Google Cloud](https://console.cloud.google.com/) → projet → active **YouTube Data API v3** et **Google Drive API**.
2. [Auth Platform](https://console.cloud.google.com/auth/overview) → appli **External**.
3. Scopes ([accès aux données](https://console.cloud.google.com/auth/scopes)) :

```
https://www.googleapis.com/auth/youtube.upload
https://www.googleapis.com/auth/youtube
https://www.googleapis.com/auth/drive.file
```

4. Client **Desktop** / Application de bureau (pas Web). Pas d’URI de redirection à saisir.
5. Publie l’appli (**Audience → Publier**) pour que les tokens ne meurent pas tous les 7 jours. L’écran « Google n’a pas vérifié » est normal : Paramètres avancés → continuer.
6. En local :

```bash
cp .env.example .env
# MAGICLIGHT_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
npm install
npm run auth
```

Deux autorisations **séparées** (YouTube, puis Drive). Colle les refresh tokens dans les secrets GitHub.

YouTube et Drive **ne peuvent pas** être demandés dans le même consentement.

---

## Réglages utiles (`config/settings.json`)

```json
"timezone": "Africa/Porto-Novo",
"videosPerDay": 1,
"newsHours": [19, 20],
"quotes.perDay": 2,
"quotes.driveFolderName": "Conseils"
```

- **Actu** → YouTube uniquement.
- **Conseils** → YouTube + Drive (dossier créé automatiquement, nom ci-dessus).
- Photo présentatrice : `assets/presenter.jpg` (URL publique calculée depuis `GITHUB_REPOSITORY`).

---

## Test local

```bash
cp .env.example .env
npm install
npm start
```

---

## Licence

MIT. Chacun utilise sa propre instance, ses propres clés, sa propre chaîne.
