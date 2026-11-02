# Accord pilote conseiller — projet

Statut : **PROJET**. Non signé, non remis. À valider par un juriste avant toute signature.
Chantier : `PILOT_LEGAL_AND_OPERATING_PROCEDURES_V1`

## Pourquoi ce document existe

Le pilote met de vraies données de vendeurs et d'acquéreurs dans un logiciel dont les limites sont
connues et documentées. Le conseiller pilote doit les connaître **avant** d'y saisir la première
donnée réelle, et son accord doit porter sur ces limites, pas sur une présentation favorable.

Ce document n'est pas un contrat de sous-traitance. Il n'en existe aucun dans le dépôt, et ce lot
n'en rédige pas : le modèle retenu est que le conseiller est **lui-même responsable du
traitement** (ADR-065 §1).

---

# PROJET DE TEXTE — à ne pas signer avant validation juridique

## 1. Objet

Le conseiller accepte d'utiliser l'application DOMIORA en conditions réelles, avec des données
personnelles réelles de ses clients et prospects, dans le cadre d'un pilote.

## 2. Rôle du conseiller

Le conseiller est le responsable du traitement des données qu'il saisit. Il détermine les finalités
et les moyens de son activité de conseil immobilier. Il renseigne son identité juridique complète
dans l'application avant toute saisie de donnée réelle.

Il lui appartient d'informer les personnes dont il saisit les données, selon la notice qui lui est
remise, et de traiter les demandes qu'elles lui adressent.

## 3. Ce que l'application fait aujourd'hui

- Elle stocke les données de ses contacts, biens, projets, visites et transactions.
- Elle produit des bons de visite signés électroniquement et les documents associés.
- Elle lit, si le conseiller l'y autorise, les sept prochains jours de son agenda Google en lecture
  seule, et peut envoyer des messages depuis sa messagerie Google.
- Elle sauvegarde la base et les documents par une procédure scriptée.

## 4. Ce que l'application ne fait pas, et le conseiller en est informé

- **Aucune suppression automatique.** Les durées de conservation sont décidées mais ne sont pas
  appliquées : aucune purge, aucun compte à rebours. Les données restent jusqu'à une suppression
  décidée.
- **Aucun outillage des droits des personnes.** Accès, effacement, opposition, limitation et
  portabilité ne disposent d'aucun parcours dans le logiciel. Chaque demande est traitée par une
  intervention manuelle de l'exploitant, documentée, dont le délai dépend de sa disponibilité.
- **Aucune notice de confidentialité publiée dans le produit.** Aucun écran ne la présente, et le
  logiciel n'enregistre pas qu'une information a été remise.
- **Un seul utilisateur.** Il n'y a pas de gestion multi-utilisateur : l'accès est binaire, et toute
  personne entrant dans l'instance accède à l'ensemble des données.
- **Aucune alerte d'erreur.** Une panne qui ne provoque pas d'indisponibilité visible peut passer
  inaperçue. Le conseiller signale ce qu'il observe ; rien ne le détecte à sa place.
- **Sauvegardes non hors site.** Elles sont écrites sur le poste de l'exploitant. Une perte de ce
  poste et de l'hébergement simultanément entraînerait une perte de données.
- **Le bon de visite n'a pas de valeur juridique établie.** Son dispositif de signature n'a pas été
  qualifié au regard des exigences applicables à une signature électronique. La transmission d'un
  dossier au notaire est une déclaration du conseiller : l'application ne transporte aucun fichier
  et ne prouve aucune remise.
- **Aucune prospection commerciale électronique n'est possible.** Le logiciel n'a aucun mécanisme
  de consentement marketing, et aucune fonction de prospection par courriel ne doit être utilisée.

## 5. Engagements du conseiller

- Ne saisir que les données nécessaires à son activité.
- Ne pas saisir de donnée sensible : état de santé, origine, opinion, orientation, condamnation.
  Aucun champ n'est prévu pour cela, et aucun contrôle technique ne s'y oppose.
- Ne recopier aucune donnée personnelle dans un champ de texte libre destiné à décrire une affaire,
  en particulier le motif d'un maintien pour contentieux.
- Signaler sans délai tout incident de sécurité ou toute demande d'une personne concernée.
- Ne pas communiquer ses identifiants, et ne pas donner accès à l'instance à un tiers.
- Accepter que des interventions manuelles en base soient nécessaires pour satisfaire une demande
  d'effacement ou d'export, et qu'elles soient réalisées par l'exploitant.

## 6. Engagements de l'exploitant du pilote

- Mettre à disposition l'application, l'héberger et la sauvegarder selon les procédures
  documentées.
- Traiter les demandes transmises par le conseiller selon les procédures d'export et d'effacement
  documentées, et lui en rendre compte.
- Ne pas accéder aux données du conseiller en dehors de ce qui est nécessaire à l'exploitation, au
  support et à l'exécution des procédures demandées.
- Informer le conseiller de tout incident affectant ses données.
- Ne jamais activer un service externe non qualifié traitant des données du conseiller sans l'en
  informer et obtenir son accord.

## 7. Durée et fin

Le pilote est conclu pour une durée déterminée, renouvelable. À son terme, le conseiller obtient
une copie exportable de ses données et décide de leur sort : conservation, restitution, ou
suppression selon la procédure documentée.

## 8. Réversibilité

À tout moment, le conseiller peut demander l'arrêt du pilote et la restitution de ses données. Le
délai de restitution dépend de l'exécution manuelle de la procédure d'export.

---

# Fin du projet de texte

## À valider par un juriste

1. **Nature du document.** Convention de test, contrat de prestation, mise à disposition gratuite :
   la qualification n'est pas tranchée et détermine le régime applicable.
2. **Absence de contrat de sous-traitance.** Si l'exploitant du pilote traite des données pour le
   compte du conseiller — ce qu'il fait dès qu'il exécute une procédure d'export ou d'effacement —
   un acte encadrant ce traitement est à évaluer. Aucun n'existe.
3. **Responsabilité en cas de perte de données.** Les sauvegardes ne sont pas hors site. La
   répartition du risque n'est pas rédigée.
4. **Bon de visite et signature électronique.** Le dispositif n'est pas qualifié. Les conséquences
   d'une contestation ne sont pas évaluées. [Non vérifié]
5. **Information des personnes concernées.** Ce document met la charge de l'information sur le
   conseiller, sans que le produit la lui facilite. Recevabilité à évaluer.
6. **Clause de confidentialité et de propriété.** Non rédigées dans ce projet.

## Décisions produit requises

1. **Durée du pilote et conditions de sortie.** Non fixées.
2. **Qui est l'exploitant, nommément.** Le document dit « l'exploitant » sans l'identifier. La même
   question que celle du responsable du traitement se pose : aucune entité n'est modélisée.
3. **Périmètre de données autorisé pendant le pilote.** Tout le CRM, ou un sous-ensemble (par
   exemple : pas de pièce d'identité, pas de RIB, alors que `documents_bien.type_document` admet
   `cni` et `rib`). À trancher, car cela change la sensibilité de l'instance.
4. **Nombre de conseillers pilotes.** Le produit est mono-utilisateur. Un second conseiller
   exigerait un second déploiement, et poserait la question non tranchée de l'appartenance du
   dossier fiscal (ADR-065 §9).
