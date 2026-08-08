This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Google Calendar (Sprint 2)

L'écran "Aujourd'hui" peut afficher les vrais rendez-vous du conseiller depuis Google Calendar
(lecture seule) au lieu des données de démonstration. Sans connexion configurée, l'app continue
de fonctionner normalement avec les mocks.

### 1. Créer les credentials OAuth dans Google Cloud Console

1. Aller sur [console.cloud.google.com](https://console.cloud.google.com), créer un projet (ou en
   sélectionner un existant).
2. **Activer l'API** : menu *APIs & Services > Library*, rechercher "Google Calendar API", cliquer
   *Enable*.
3. **Configurer l'écran de consentement** : *APIs & Services > OAuth consent screen*.
   - Type d'utilisateur : *External* (ou *Internal* si le compte Google est un Google Workspace).
   - Renseigner un nom d'application et un email de support.
   - Scopes : ajouter `https://www.googleapis.com/auth/calendar.events.readonly`.
   - Onglet *Test users* : ajouter l'adresse Gmail du conseiller (obligatoire tant que l'app reste
     en mode *Testing* — aucune validation Google n'est nécessaire dans ce mode, avec une limite de
     100 utilisateurs de test).
4. **Créer les identifiants** : *APIs & Services > Credentials > Create Credentials > OAuth client ID*.
   - Type d'application : *Web application*.
   - *Authorized redirect URIs* : ajouter `http://localhost:3000/api/auth/google/callback` (adapter
     le domaine en production).
   - Récupérer le **Client ID** et le **Client Secret** affichés.

### 2. Remplir `.env.local`

Copier le template :

```bash
cp .env.local.example .env.local
```

Puis renseigner :

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` : valeurs récupérées à l'étape précédente.
- `GOOGLE_REDIRECT_URI` : `http://localhost:3000/api/auth/google/callback` en local (doit
  correspondre exactement à une des *Authorized redirect URIs* déclarées côté Google).
- `GOOGLE_TOKEN_ENCRYPTION_KEY` : générer une clé aléatoire de 32 octets :

  ```bash
  openssl rand -base64 32
  ```

`.env.local` n'est jamais commité (voir `.gitignore`).

### 3. Procédure de test local

1. `pnpm dev`, ouvrir [http://localhost:3000](http://localhost:3000).
2. Sans connexion configurée : l'écran Aujourd'hui affiche les rendez-vous mockés avec l'indicateur
   *"Source : Données de démonstration"* et un lien *"Connecter Google Calendar"*.
3. Cliquer sur ce lien, valider le consentement Google (le premier écran de consentement doit
   apparaître, avec la mention "accès non vérifié" normale en mode *Testing* — cliquer *Continuer*).
4. Après redirection vers `/`, l'indicateur doit passer à *"Source : Google Calendar"* et les
   rendez-vous du jour affichés doivent correspondre au calendrier Google réel du conseiller.
5. Créer un événement de test dans Google Calendar aujourd'hui (avec une heure, un lieu) et
   rafraîchir la page : il doit apparaître avec le badge générique "Événement".
6. Créer un événement "toute la journée" : il doit apparaître avec la mention "Toute la journée"
   au lieu d'une heure.
7. Annuler/supprimer un événement du jour : il doit disparaître de la liste après rafraîchissement.
8. Cliquer sur *"Déconnecter"* : retour à l'indicateur "Données de démonstration".
9. Pour tester le cas d'erreur : se reconnecter, puis révoquer l'accès depuis
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions) (retirer l'accès de
   l'application) sans cliquer sur "Déconnecter" dans Atlas. Recharger l'écran Aujourd'hui : il doit
   afficher *"Google Calendar indisponible — données de démonstration affichées"* avec un lien
   *"Se reconnecter"* (celui-ci force à nouveau l'écran de consentement pour obtenir un nouveau
   refresh token).
