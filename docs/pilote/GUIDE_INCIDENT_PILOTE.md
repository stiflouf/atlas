# Un problème pendant le pilote — guide du conseiller

Une page. Destiné au **conseiller pilote**, pas à l'exploitant.
Le diagnostic technique est dans `docs/PILOT_RUNBOOK.md` §9 ; ne pas le dupliquer ici.

## La règle qui compte

**Signalez. Rien ne détecte un problème à votre place.**

Il n'existe aucune alerte, aucun agrégateur d'erreurs, aucun compteur. Une erreur que vous ne
signalez pas reste invisible, même si elle vous a fait perdre une saisie.

## Avant d'appeler : deux choses, trente secondes

1. **Ouvrez cette adresse dans votre navigateur :**

   ```
   https://domiora-production.up.railway.app/api/health
   ```

   - Trois fois `UP` → l'application fonctionne, le problème est ailleurs (votre connexion, votre
     navigateur, ou un point précis du produit).
   - Une ligne `DOWN`, ou une erreur → c'est une panne de l'application. Signalez immédiatement et
     **arrêtez de saisir** : une saisie pendant une panne de base peut ne pas être enregistrée.

2. **Notez la référence technique si un écran d'erreur s'affiche.** L'écran porte une
   `Référence technique`. Sans elle, l'erreur est très difficile à retrouver dans les journaux.
   Avec elle, c'est immédiat.

## Quoi signaler, et dans quel ordre

| Priorité | Situation | Délai de signalement |
|---|---|---|
| 1 | Une donnée personnelle visible par quelqu'un qui ne devait pas la voir, ou un accès que vous ne reconnaissez pas | **immédiatement**, sans attendre d'être sûr |
| 1 | Une personne vous demande l'accès, la rectification, l'effacement ou la copie de ses données | **immédiatement** — le traitement est manuel et prend du temps |
| 1 | Une contestation, une réclamation, un litige, un courrier d'avocat concernant un dossier | **immédiatement** — des pièces doivent être protégées avant toute autre action |
| 2 | Application inaccessible, impossible de se connecter, documents en erreur | le jour même |
| 2 | Une donnée que vous avez saisie a disparu, ou n'est pas celle que vous avez saisie | le jour même, **avec la référence technique si elle existe** |
| 3 | Un document ne se télécharge pas, un bon de visite ne se signe pas | le jour même |
| 3 | Agenda ou envoi de messages ne fonctionnent plus | quand vous pouvez — reconnectez d'abord votre compte Google depuis l'accueil |
| 4 | Comportement étrange sans conséquence, lenteur, affichage incorrect | dans la semaine |

## Message de signalement — les cinq lignes utiles

```
Ce que je faisais   :
Ce que j'attendais  :
Ce qui s'est passé  :
Référence technique :
Heure (approx.)     :
```

**N'écrivez aucune donnée personnelle de vos clients dans ce signalement.** L'identifiant du
dossier ou la référence du bien suffisent à le retrouver. Pas de nom, pas d'adresse, pas de
courriel de client.

## Ce que vous ne devez pas faire

- **Ne retentez pas une action qui a échoué sans le dire.** Un envoi de message au statut incertain
  peut avoir été expédié : réessayer peut l'envoyer deux fois, et rien ne le détecte.
- **Ne supprimez rien pour « nettoyer ».** Il n'existe presque aucune suppression dans le produit,
  et celles qui existent sont définitives.
- **Ne modifiez pas un bon de visite signé.** C'est impossible par conception, et c'est voulu : il
  constitue l'instantané de ce qui a été signé.
- **Ne prêtez pas votre accès.** Il n'y a pas de gestion multi-utilisateur : quiconque entre voit
  tout.
- **Ne promettez aucun délai à une personne qui exerce ses droits.** Le traitement est manuel.
  Transmettez la demande, l'exploitant vous indique le délai réel.

## Si vous recevez une demande d'une personne concernée

Transmettez-la telle quelle, avec l'identifiant du contact si vous l'avez. Les procédures existent
et sont documentées :

- accès ou copie des données → `docs/pilote/PROCEDURE_EXPORT_PERSONNE.md`
- effacement → `docs/pilote/PROCEDURE_EFFACEMENT_PERSONNE.md`

Aucune des deux n'est outillée dans le produit : elles demandent une intervention manuelle en base
par l'exploitant. Vous ne pouvez pas les exécuter vous-même, et ce n'est pas un oubli.

## Si un litige se déclare sur un dossier

Dites-le **avant toute autre action**, et ne supprimez rien sur le dossier concerné. Des pièces —
en particulier un bon de visite signé — peuvent devoir être maintenues en conservation. Voir
`docs/pilote/PROCEDURE_LEGAL_HOLD.md`.

## Ce qui est normal, et n'est pas un incident

- Les durées de conservation ne s'appliquent pas : rien ne disparaît tout seul. C'est l'état connu
  du produit, pas une anomalie.
- Un identifiant de données de démonstration devient introuvable dès que de vraies données existent
  dans la même catégorie. C'est le comportement attendu.
- L'agenda n'affiche que les sept prochains jours, jamais le passé.
- Un message envoyé n'a pas d'accusé de réception : l'application ne lit pas votre boîte.
