# YouTube Automation — 1 actu du soir + 2 conseils / jour

Pipeline **Node.js + GitHub Actions** :

1. **Actu mondiale** (1× / jour vers 19h–20h Cotonou) → vidéo complète MagicLight (`/stanleystawa/fullvideo`)
2. **Conseils** (2× / jour) → clip 10 s (ou 20 s) MagicLight (`/stanleystawa/video`), **la présentatrice de `assets/presenter.jpg`**, plus conseil que citation
3. Sauvegarde le MP4 sur **Google Drive**
4. Publie sur **YouTube** (titre, hashtags, mention IA)

---

## Architecture

```
GitHub Actions
  12:20 / 16:20 Cotonou  →  2 conseils (même présentatrice)
  19:20 / 20:20 Cotonou  →  1 actu mondiale (Gemini + Search)
  22:20                  →  filet si une génération n’était pas encore prête
        │
        ├─ Vidéo MagicLight prête  → Drive + YouTube
        └─ Hors créneau            → rien (pas de run inutile toutes les heures)
```

---

## 1. Créer le dépôt GitHub

```bash
cd youtube-automation
git init
git add .
git commit -m "feat: pipeline YouTube automation 3 vidéos/jour"
gh repo create youtube-automation --public --source=. --remote=origin --push
```

(Ou crée le repo vide sur github.com/stanleystaw puis `git remote add origin …` + `git push -u origin main`.)

---

## 2. Clé MagicLight

1. Crée un compte sur le studio (Gmail, voir [la doc API](https://magiclight-api-gamma.vercel.app/docs)).
2. Récupère `user.api_key`.
3. Vérifie tes crédits : **12 crédits / actu** + **7 crédits / conseil** (14 si 20 s).

Compte Développeur conseillé si tu branches ce bot en continu.

---

## 3. Google Cloud — YouTube + Drive

Fais-le **une fois**, sur le compte Google de la chaîne.
Interface 2025–2026 : **Google Auth Platform** (Brand / Audience / Accès aux données / Clients).

### 3.1 Activer les APIs (sinon les scopes n’apparaissent pas)

1. [Google Cloud Console](https://console.cloud.google.com/) → crée un projet (`youtube-automation`).
2. Menu ☰ → **APIs & Services** (APIs et services) → **Library** (Bibliothèque).
3. Active **YouTube Data API v3** puis **Google Drive API** (bouton Enable / Activer).

### 3.2 Écran de consentement + scopes + utilisateurs test

Ouvre [Google Auth Platform](https://console.cloud.google.com/auth/overview) (ou cherche « OAuth » en haut).

**A. Premier lancement** → **Get started** / Commencer :

1. Nom de l’appli + email de support
2. Public : **External** / Externe (pas Internal)
3. Email de contact → Create

**B. Scopes — onglet Data access / Accès aux données**  
(ce n’est **pas** dans le formulaire du client OAuth)

Lien direct : [console.cloud.google.com/auth/scopes](https://console.cloud.google.com/auth/scopes)

1. **Add or remove scopes** / Ajouter ou supprimer des champs d’application
2. Filtre ou colle **manuellement** (un par ligne) :

```
https://www.googleapis.com/auth/youtube.upload
https://www.googleapis.com/auth/youtube
https://www.googleapis.com/auth/drive.file
```

3. **Update** puis **Save**

YouTube / Drive sont des scopes *sensibles*. En mode **Testing**, pas besoin de vérification Google : seuls tes utilisateurs test peuvent autoriser l’appli.

**C. Utilisateur test — onglet Audience / Public**  
[console.cloud.google.com/auth/audience](https://console.cloud.google.com/auth/audience) → **Add users** → le Gmail de la chaîne YouTube.

### 3.3 Client OAuth « Application de bureau »

[Créer un client](https://console.cloud.google.com/auth/clients/create) :

| Champ | Valeur |
|---|---|
| Type d’application | **Desktop app** / **Application de bureau** / **Ordinateur** |
| Nom | `youtube-automation-local` |

**Il n’y a PAS de champ « URI de redirection »** pour ce type : c’est normal.  
Google autorise tout seul `http://127.0.0.1` (n’importe quel port). Notre script utilise `http://127.0.0.1:53682/callback`.

Clique **Create**, copie `Client ID` et `Client secret`.

> Si tu as choisi **Application Web** par erreur : ouvre le client → **Authorized redirect URIs** → ajoute exactement  
> `http://127.0.0.1:53682/callback`  
> (sans slash à la fin). Ou supprime-le et recrée un client **Desktop**.

### 3.4 Refresh token (en local)

```bash
cp .env.example .env
# remplis MAGICLIGHT_API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
npm install
npm run auth
```

Le navigateur s’ouvre → tu autorises → le script écrit `GOOGLE_REFRESH_TOKEN` dans `.env`.

> Si Google ne renvoie pas de refresh token : va sur  
> https://myaccount.google.com/permissions → révoque l’appli → relance `npm run auth`.

---

## 4. Secrets GitHub Actions

Repo → **Settings → Secrets and variables → Actions → New repository secret** :

| Secret | Obligatoire | Description |
|---|---|---|
| `MAGICLIGHT_API_KEY` | oui | Clé API MagicLight https://magiclight-api-gamma.vercel.app/ |
| `GOOGLE_CLIENT_ID` | oui | OAuth client |
| `GOOGLE_CLIENT_SECRET` | oui | OAuth secret |
| `GOOGLE_REFRESH_TOKEN_YOUTUBE` | oui | 1ʳᵉ autorisation (`npm run auth`) |
| `GOOGLE_REFRESH_TOKEN_DRIVE` | oui | 2ᵉ autorisation (`npm run auth`) |
| `DRIVE_FOLDER_ID` | non | ID du dossier Drive (sinon création auto « YouTube Automation ») |
| `GEMINI_API_KEY` | oui (actu + conseils) | Clé [Google AI Studio](https://aistudio.google.com/apikey) |
| `YOUTUBE_PRIVACY` | non | `public` (défaut), `unlisted` ou `private` |

---

## 5. Activer Actions

1. Onglet **Actions** du repo → autorise les workflows.
2. **YouTube Automation → Run workflow** pour un test manuel.
3. Le cron tourne ensuite tout seul :
   - `20 11,15 * * *` UTC → 12:20 et 16:20 Cotonou (2 conseils / jour)
   - `20 18,19 * * *` UTC → 19:20 et 20:20 Cotonou (actu)
   - `20 21 * * *` UTC → 22:20 Cotonou (filet publication)

---

## 6. Personnaliser les vidéos

| Fichier | Rôle |
|---|---|
| `config/ideas.json` | File d’idées (90 déjà prêtes, une par vidéo) |
| `config/settings.json` | Langue, format, quota, tags YouTube, template de description |

Réglages utiles :

```json
"language": "french",
"ratio": 1,
"videosPerDay": 1,
"quotes.perDay": 2,
"youtube.privacyStatus": "public"
```

Lancement manuel avec une idée précise : **Actions → Run workflow** → remplis le champ *Idée personnalisée*.

---

## 7. Test en local

```bash
cp .env.example .env   # remplis les 4 secrets
npm install
npm start
```

Le MP4 transite par `.tmp/` (gitignoré), puis Drive + YouTube. L’état est dans `data/state.json` (aussi recopié sur Drive).

---

## Coûts & limites

- MagicLight : **12 crédits / vidéo complète**, **une seule à la fois**.
- YouTube Data API : `videos.insert` ≈ 1600 unités. Quota par défaut 10 000 / jour → 3 uploads OK.
- GitHub Actions : jobs courts (quelques minutes). Repo **public** = minutes illimitées ; repo privé = 2000 min / mois (largement suffisant ici).
- Filigrane MagicLight `STANGENX` : présent sur toutes les vidéos (imposée par l’API).
- YouTube exige de **déclarer le contenu généré par IA** : c’est déjà dans le template de description.

---

## Dépannage

| Symptôme | Cause probable |
|---|---|
| `Secrets manquants` | Secrets GitHub non créés ou mal nommés |
| `401 / invalid_grant` | Refresh token révoqué → relancer `npm run auth` |
| `This app is in blocked mode` / upload YouTube refusé | Ajoute le Gmail de la chaîne en **test user** OAuth |
| `409 Une vidéo complète est déjà en cours` | Normal : le run suivant publiera dès que c’est `done` |
| Crédits insuffisants | Recharger le compte MagicLight (36 crédits / jour minimum) |
| Rien ne se lance avant 6 h | `minHoursBetweenStarts` — baisse-le dans `settings.json` |
| Workflow gris / skip | Actions désactivées, ou cron GitHub en retard (fréquent sur le plan gratuit, jusqu’à ~15 min) |

Logs : onglet **Actions** → dernier run → étape *Générer / publier*.

---

## Sécurité

- **Ne commite jamais** `.env` ni un token GitHub / Google.
- Si un token a été collé dans un chat, un ticket ou un README : **révoque-le immédiatement**  
  GitHub → Settings → Developer settings → Personal access tokens → Delete  
  puis recrée-en un **uniquement** si tu en as besoin, sans le partager.
