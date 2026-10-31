# Qaloon 365 (حفظ القراۤن 365) — Plan d'amélioration & d'optimisation

Date : 2026-09-14
Statut : **Spec — à valider avant implémentation**
App : `hifdh-qaloon-365` — مصحف قالون عن نافع / الورد اليومي وخطة الحفظ 365
Code : `C:\Users\dell\.gemini\antigravity\scratch\hifdh-qaloon-365\`
Prod : `https://hifdh-qaloon-365.vercel.app/`

---

## 1. Contexte et constats

L'app a été signalée comme « ne permettant pas de transiter entre les journées ».

### Diagnostic réalisé (vérifications en prod, le 14/09/2026)

| Vérification | Constat |
|---|---|
| Boutons السابق / اليوم X من 365 / التالي | ✅ Présents et fonctionnels (testé en live : passage jour 1 → jour 2) |
| Calendrier جدول 365 | ✅ Modal complet : 12 mois, grille des 30 jours, recherche, clic = chargement direct du jour |
| Rendu mobile (390×844) | ✅ Navigation visible en haut de page |
| Console JS | ⚠️ 3 points mineurs : favicon.ico 404, 5 champs de formulaire sans label, warning Tailwind CDN |
| Service worker `/sw.js` | ✅ Network-first + `skipWaiting` + `clients.claim` → pas de blocage par cache |
| Sync cloud (`api/sync.js`) | ⚠️ 1 GET initial 404 puis POST 200 OK (fonctionne, mais voir §4) |
| Audio | ❌ **Mismatch riwaya** : l'app affiche « قالون عن نافع / الشيخ الحصري » mais streame `everyayah.com/data/Husary_128kbps/…` = **Hafs standard** |

### Cause racine du problème utilisateur

La navigation **existe et fonctionne en prod**. Le problème vient de la **PWA installée sur le téléphone** qui sert une **ancienne version mise en cache** (antérieure à l'ajout des boutons de navigation). Solution immédiate (info utilisateur) : menu réglages → bouton **« تحديث ومسح الكاش 🔄 »** (`forceAppRefresh()` l.3232 : vide les caches, désenregistre le SW, recharge). Filet de sécurité : **export JSON** (l.758) disponible avant toute manipulation.

Ce constat ne bloque pas ce plan d'amélioration ; il est consigné pour information et traité dans le §5 (robustesse de mise à jour).

---

## 2. Objectifs de ce plan

1. **Audio** : fournir une vraie récitation **Qaloun** (قالون عن نافع) conforme à l'identité de l'app, au lieu du Hafs actuel.
2. **Sécurité** : fermer l'exposition de la clé Firestore et le CORS ouvert dans `api/sync.js`.
3. **UX / robustesse** : rendre la navigation entre jours plus découvrable, fiabiliser la mise à jour de la PWA, corriger les points mineurs.
4. **Performance / maintenance** : sortir de Tailwind CDN en prod, corriger le favicon 404.

Priorité : **1. Audio > 2. Sécurité > 3. UX > 4. Perf**. (Le volet UX est déjà couvert fonctionnellement ; le reste est du polish.)

---

## 3. Volet Audio — vraie récitation Qaloun

### État actuel

- `getSurahDataFromRaw()` (~l.1000) construit : `https://everyayah.com/data/Husary_128kbps/${surahPadded}${ayahPadded}.mp3`
- `everyayah` `Husary_128kbps` = récitation **Hafs** selon le cheikh al-Husary (standard), **pas** Qaloun.
- Dossier local `audio/qaloon_husary/` : **24 fichiers seulement** (sourates 1, 2, 18 partiels) — trop incomplet pour remplacer le streaming.

### Options

| Option | Description | Coût / effort | Recommandé |
|---|---|---|---|
| **A — everyayah Qaloun** | Chercher/vérifier la variante `Qaloon` (ou `Qanbari`) sur everyayah (`/data/…/`). Si disponible, changer le préfixe URL uniquement. | Très faible | ⭐ si existe |
| **B — mp3quran.org (API)** | `https://mp3quran.org/api/` — endpoint `quran` avec `riwayah=4` (Qaloun). Streaming direct, gratuit, sans clé. | Faible (modifier l'URL + vérifier le format) | ⭐ probablement la meilleure source |
| **C — Fichiers locaux** | Pré-télécharger l'intégralité (scène ~6 236 ayahs) dans `/audio/` et servir depuis l'app. | Moyen-élevé (taille, poids PWA, offline partiel) | À n'envisager que si A/B indisponibles |
| **D — API Quran.com** | `https://api.quran.com/api/v4/recitations/…` — récitations Qaloun possibles mais nécessite une clé API (`NUN` etc.). | Élevé (clé, quota payant) | ✗ |

**Recommandation** : tester **B (mp3quran `riwayah` Qaloun)** en premier, garder **A** comme bascule rapide. Le changement doit rester **configurable** (une constante `AUDIO_SOURCE` en tête de `index.html`) pour pouvoir basculer en cas de panne d'une source.

### Acceptation
- [ ] L'audio du jour 1 et d'un jour aléatoire (ex. jour 200) est bien une récitation **Qaloun** (vérification auditive + nom `riwayah` dans l'URL).
- [ ] `AUDIO_SOURCE` configurable en tête de fichier.
- [ ] Fallback propre (fichier local si présent, sinon réseau) — sans reprise du Hafs par défaut.

---

## 4. Volet Sécurité — clé Firestore exposée + CORS ouvert

### État actuel (`api/sync.js`)

- Clé **publique** Firestore : `AIzaSyDIc44Bwr6J67PsngXXT85CFSaGCy1xUuQ` (projet `apexcrm-f4d3a`).
- `Access-Control-Allow-Origin: *` pour toutes les méthodes (GET/POST/PUT/PATCH/DELETE).
- Pas d'authentification : n'importe qui peut lire/écrire sur la collection `storage/qaloon` si les règles Firestore le permettent.

### Actions

1. **Règles Firestore** (Console Firebase → Règles) : restreindre l'accès à la collection de sync.
   - Lecture : uniquement `request.auth != null` (ou mesure de lecture publique seulement si nécessaire à un vrai besoin multi-appareils).
   - Écriture : `request.auth != null` + validation de structure (fields attendus, `syncId` connu).
   - État actuel à vérifier d'abord (Firebase CLI ou Console) avant de fixer la cible.
2. **`api/sync.js`** :
   - Restreindre `Access-Control-Allow-Origin` à l'origine de l'app (`https://hifdh-qaloon-365.vercel.app` et alias, pas `*`).
   - Ajouter un **secret d'API** en variable d'environnement Vercel, vérifié en header (`x-api-key`), au moins pour les écritures.
   - Limiter les méthodes acceptées et valider les corps (`syncId` regex `^[A-Z0-9-]{4,32}$`, taille max, types).
   - Ne pas **supprimer** la clé du client (elle est dans le bundle public et insuppressible) — la vraie protection = règles Firestore + secrets server-side. Documenter ce point pour éviter une fausse sécurité.
3. **Recommandation complémentaire** : chiffrer le `syncId`/état local et n'envoyer au serveur que le **delta minimal** nécessaire (pas la totalité du state si non requis).

### Acceptation
- [ ] Règles Firestore en place (lecture + écriture authentifiées/structurées).
- [ ] `Access-Control-Allow-Origin` restreint (pas `*`).
- [ ] Écritures protégées par `x-api-key` de variable d'env Vercel.
- [ ] Validation serveur des payloads (format, taille, types).
- [ ] Vérification fail-closed : requête sans clé / mauvais `syncId` → **4xx**, pas 200.

---

## 5. Volet UX & robustesse

### 5.1 Mise à jour fiable de la PWA (cause racine du retour utilisateur)

- Le SW est network-first : ça sert déjà la dernière version **quand on est en ligne**. Ce qui explique une version figée côté téléphone : contenu servi **hors ligne** de longue date, ou navigateur ayant décidé de ne pas refaire un fetch (ancien cache du shell).
- Actions :
  - **Bump du `CACHE_NAME`** (`hifdh-qaloon-v6` → `v7`+ ) à chaque release : garantit le remplacement de l'ancien cache à l'installation du nouveau SW.
  - **Afficher une bannière de mise à jour** : `navigator.serviceWorker.addEventListener('updatefound'…)` → si un nouveau SW s'installe, proposer « Recharger » (pattern classique).
  - Conserver `forceAppRefresh()` mais le rendre plus visible si le problème persiste.

### 5.2 Découvrabilité de la navigation

- Fonctionnelle aujourd'hui. Améliorations légères, non bloquantes :
  - Icônes fléchées claires + tooltip « aujourd'hui » quand on est sur le jour courant.
  - Dans le calendrier : surligner le jour courant + jour de l'utilisateur (`hifdh_current_day`).
  - Toucher traversable : balayer gauche/droite pour changer de jour sur mobile.

### 5.3 Points mineurs

- **favicon.ico 404** : les assets existent en local (`favicon-16.png`, `favicon-32.png`, `icon.svg`) — s'assurer que `vercel.json`/headers les sert correctement, ou référencer `icon.svg`/`favicon.svg` dans le `<head>`.
- **Accessibilité** : ajouter des `<label>` aux 5 champs de formulaire (recherche calendrier etc.) et des `aria-*` aux boutons icône.

---

## 6. Volet Performance & maintenance

- **Tailwind CDN** (`cdn.tailwindcss.com`) : warning en prod → **Purge/CLI ou build embedded** (générer le CSS de prod et l'inliner) pour éviter la pénalité de perf et le flash au chargement.
- **`lucide` via unpkg `@latest`** : remplacer par une version **épinglée** (déjà résolue en 1.46.0 dans le réseau) ou intégrer les icônes en SVG inline pour supprimer la requête tierce.
- **Chargement des polices** : `display=swap` déjà présent — vérifier l'empreinte réseau des 5 familles (Amiri, Noto Naskh, Plus Jakarta, Cinzel) ; ne charger que ce qui est réellement utilisé.
- **Considérer le cache local `pages_cache.json` + `baqarah_25.json`** (87 Ko balisés « test ») : documenter leur usage ou les purger.

---

## 7. Hors périmètre (nié / différence)

- **Pas de backend payant** : aucune API payante (Quran.com NUN, clé Google).
- **Pas de refonte UI globale** : l'app est fonctionnelle et harmonieuse ; le plan reste ciblé.
- **Pas de modification du plan 365** (`schedule_365.js` intact — données validées).
- **Pas de nouveau déploiement source différente** : Vercel existant conservé.

---

## 8. Définition de fait (Definition of Done) globale

- [ ] §3 : audio Qaloun réellement diffusé + `AUDIO_SOURCE` configurable + fallback propre.
- [ ] §4 : règles Firestore durcies, CORS restreint, `x-api-key` Vercel en place, validation serveur, tests fail-closed verts.
- [ ] §5 : `CACHE_NAME` bumpé, bannière de mise à jour, navigation plus découvrable, favicon 200, labels accessibilité.
- [ ] §6 : Tailwind hors CDN en prod, lucide épinglé, polices épurées.
- [ ] Re-test manuel complet en prod sur navigateur **et** PWA mobile (après « تحديث ومسح الكاش »).

---

## 9. Ordre prévisionnel d'implémentation

1. **§4 Sécurité** (risque le plus élevé — à faire dès le premier cycle de code).
2. **§3 Audio Qaloun** (valeur utilisateur principale).
3. **§5.1 Bump cache + bannière de mise à jour** (règle le retour initial).
4. **§5.2/5.3 + §6** (polish, perf, accessibilité).

Chaque volet est indépendant et peut vivre dans son propre commit/déploiement.