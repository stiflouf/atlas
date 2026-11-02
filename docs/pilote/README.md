# Prérequis non techniques du pilote avec données réelles

Chantier : `PILOT_LEGAL_AND_OPERATING_PROCEDURES_V1`

Ces neuf documents ferment les prérequis **non techniques** avant de saisir de vraies données de
vendeurs et d'acquéreurs dans DOMIORA avec un premier conseiller pilote.

Aucune fonctionnalité n'est développée par ce lot. Aucun code produit n'est modifié. Aucune
suppression automatique, aucune purge, aucun `Retention apply`, aucun multi-utilisateur. Ni Google,
ni la plateforme d'hébergement, ni la production, ni la base de production ne sont touchés.

## Les documents

| Document | Nature | État |
|---|---|---|
| [NOTICE_INFORMATION_PERSONNES.md](NOTICE_INFORMATION_PERSONNES.md) | projet de notice aux personnes | projet, non publié |
| [IDENTITE_RESPONSABLE_TRAITEMENT.md](IDENTITE_RESPONSABLE_TRAITEMENT.md) | formulaire de recueil | vierge, prêt à remplir |
| [INFORMATION_GOOGLE.md](INFORMATION_GOOGLE.md) | information Calendar / Gmail | factuel, vérifié dans le code |
| [ACCORD_PILOTE_CONSEILLER.md](ACCORD_PILOTE_CONSEILLER.md) | projet d'accord pilote | projet, non signé |
| [PROCEDURE_EFFACEMENT_PERSONNE.md](PROCEDURE_EFFACEMENT_PERSONNE.md) | procédure manuelle | testée sur base jetable |
| [PROCEDURE_EXPORT_PERSONNE.md](PROCEDURE_EXPORT_PERSONNE.md) | procédure manuelle | testée sur base jetable |
| [PROCEDURE_LEGAL_HOLD.md](PROCEDURE_LEGAL_HOLD.md) | procédure manuelle | testée sur base jetable (13 contrôles) |
| [PROCEDURE_SAUVEGARDE_RESTAURATION.md](PROCEDURE_SAUVEGARDE_RESTAURATION.md) | procédure d'exploitation | scripts préexistants, inchangés |
| [GUIDE_INCIDENT_PILOTE.md](GUIDE_INCIDENT_PILOTE.md) | guide du conseiller | une page |
| [GATE_DONNEES_REELLES.md](GATE_DONNEES_REELLES.md) | gate opérationnel d'entrée des données réelles | `CLOSED` |

## Ce que ces documents ne remplacent pas

- `docs/KNOWN_LIMITATIONS.md` reste la source canonique sur l'absence d'outillage RGPD, la
  conservation non appliquée, le legal hold sans surface et la quarantaine.
- `ops/backup/README.md` reste la source canonique du mode opératoire de sauvegarde.
- `docs/PILOT_RUNBOOK.md` reste la source canonique du déploiement, du rollback et du diagnostic
  technique d'incident.
- ADR-065, 066, 067, 068 et 069 restent les décisions. Ces documents les appliquent, ils ne les
  rouvrent pas.

## Deux faits qui conditionnent tout le reste

1. **Le produit n'applique aucune durée de conservation.** `RETENTION_ENFORCEMENT_V1_LIVRE = false`,
   `APPLY_SUPPORTED = false`. Rien ne disparaît tout seul. C'est la raison pour laquelle le projet
   de notice n'annonce aucune durée chiffrée.
2. **Les droits des personnes ne sont pas outillés.** Accès, effacement et portabilité passent par
   une intervention manuelle en base, par l'exploitant, selon les procédures de ce répertoire. Le
   conseiller ne peut pas les exécuter.

## Comment les tests ont été conduits

Base PostgreSQL 16 jetable `atlas_proc_v1`, schéma complet appliqué par `drizzle-kit migrate`,
peuplée de données **synthétiques** (`SYNTH-*`, adresses en `@example.invalid`).

Aucune donnée réelle n'a été lue. Aucune donnée personnelle n'a été affichée : les tests
n'impriment que des compteurs, des noms de contraintes, des codes de sortie et des clés de
structure. La production n'a pas été touchée, et la base jetable a été détruite après les tests.

## Ce qui reste à décider

Chaque document porte ses propres sections `À valider par un juriste` et `Décisions produit
requises`. Les points bloquants pour l'entrée en pilote avec données réelles :

1. Saisir l'identité juridique du responsable du traitement — sans elle, aucune notice ne peut
   nommer qui traite les données.
2. Trancher le canal de remise de la notice, et si sa remise est tracée.
3. Faire valider le projet de notice et le projet d'accord pilote par un juriste.
4. Décider du périmètre de données autorisé pendant le pilote (en particulier pièces d'identité et
   coordonnées bancaires, que le schéma accepte).
5. Trancher la destination de sauvegarde hors site, qui est une décision de sous-traitance.

## Chantier suivant

`PILOT_INSTANCE_PROVISIONING_V1` — le modèle d'exploitation est désormais tranché par
[ADR-070](../adr/070-modele-instance-pilote-dediee.md) : **un projet d'hébergement entièrement dédié
par conseiller**, sans aucune ressource métier ni de stockage partagée avec la production personnelle
ni avec le showroom.

```
PILOT_RAILWAY_PLACEMENT = DEDICATED_PROJECT
```

ADR-070 tranche la question ouverte n°2 d'ADR-054 pour le pilote et le modèle d'exploitation initial
seulement ; elle ne décide rien de l'architecture multi-tenant future. Elle ne crée aucune ressource :
le provisioning reprend après elle.
