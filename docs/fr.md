# PETLIBRO

Cette intégration amène dans Gladys les appareils connectés **PETLIBRO** :
les **distributeurs** (Granary, Air, One RFID, Space, Polar pour la pâtée) et
les **fontaines Dockstream**, par le cloud PETLIBRO (celui de l'application
PETLIBRO). Non officielle, sans lien avec PETLIBRO.

> **Version de développement (0.1).** Construite à partir des clients
> communautaires de l'API PETLIBRO (l'intégration Home Assistant et
> homebridge-petlibro-2) et testée avec des réponses simulées, pas encore avec
> un vrai compte. Vos retours sont les bienvenus sur le dépôt GitHub.

## Avant de commencer : un second compte PETLIBRO

PETLIBRO n'autorise **qu'une session par compte** : quand Gladys se connecte
avec le compte de votre téléphone, l'application PETLIBRO est déconnectée, et
inversement. Comme le recommandent les intégrations Home Assistant et
Homebridge, donnez donc à Gladys **son propre compte PETLIBRO, et partagez-lui
vos appareils** :

1. Créez un second compte PETLIBRO avec une autre adresse e-mail (dans
   l'application, sur un autre téléphone, ou après vous être déconnecté de
   votre compte principal).
2. Connectez-vous à l'application PETLIBRO avec votre compte **principal**,
   ouvrez chaque appareil et partagez-le avec l'e-mail du second compte (option
   de partage des réglages de l'appareil ; son libellé dépend de la version de
   l'application). Acceptez le partage sur le second compte si l'application
   le demande.
3. Dans Gladys, saisissez l'e-mail et le mot de passe du **second** compte.

Les appareils partagés apparaissent alors dans Gladys, et l'application
PETLIBRO reste connectée sur votre téléphone. Si vous utilisez malgré tout le
même compte aux deux endroits, l'intégration voit que son jeton est refusé
juste après sa connexion : elle attend 15 minutes, réessaie une fois, puis
s'arrête et demande un second compte.

## Ce que vous obtenez

Un appareil Gladys par appareil PETLIBRO :

| Appareil                                                                    | Dans Gladys                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Distributeur de croquettes (Granary, Granary Camera, Air, One RFID, Space)  | bouton « Distribuer maintenant », interrupteur « Programme de repas », niveau de croquettes (faible/normal ; un par réservoir sur le Granary à deux réservoirs), distribué aujourd'hui (portions), repas aujourd'hui, dernier repas (portions), déshydratant (% de son cycle, jours restants, bouton « Déshydratant remplacé »), batterie, batterie faible, sur secteur, en ligne                                    |
| Distributeur de pâtée Polar                                                 | niveau, température, nettoyage (% de son cycle, jours restants, bouton « Nettoyé »), batterie, batterie faible, en ligne                                                                                                                                                                                                                                                                                             |
| Fontaine Dockstream (Dockstream, Dockstream RFID, Dockstream 2, 2 Cordless) | interrupteur « Pompe » (Dockstream 2), eau (faible/normal selon le seuil d'eau basse réglé dans l'application, Dockstream 2), niveau d'eau %, eau restante (mL), bu aujourd'hui (mL), abreuvements aujourd'hui, filtre (% de son cycle, jours restants, bouton « Filtre remplacé »), nettoyage (% de son cycle, jours restants, bouton « Nettoyé »), batterie, en charge et sur secteur (Cordless), erreur, en ligne |

- Les **portions** sont comptées comme l'application PETLIBRO les compte (un
  douzième de tasse sur la plupart des distributeurs ; celles de l'Air sont
  deux fois plus petites).
- Les **consommables** (déshydratant, filtre, nettoyage) sont dans la
  catégorie maintenance de Gladys : le pourcentage restant de leur cycle (le
  cycle réglé dans l'application PETLIBRO, 30 jours par exemple), à côté des
  jours restants. Après avoir changé le filtre ou le déshydratant, ou nettoyé
  la fontaine, appuyez sur le bouton correspondant : PETLIBRO relance le
  décompte.
- Le dernier repas est daté de l'heure à laquelle il a été distribué, pas de
  celle de la lecture.
- Le badge de chaque appareil indique `cloud` ; `injoignable` avec un point
  orange quand PETLIBRO signale l'appareil hors ligne, `injoignable` simple
  quand PETLIBRO ne répond pas.

Pas encore pris en charge : la litière Luma, la caméra du Granary Camera, les
assiettes et le couvercle du Polar (sa distribution manuelle à lui), la
modification des programmes de repas, et les réglages de lumière, son,
verrouillage enfant et écran. La première génération de Dockstream ne peut
pas arrêter sa pompe : elle n'a pas d'interrupteur « Pompe ».

## Installation

1. Installez l'intégration depuis le store Gladys.
2. Dans l'onglet **Configuration**, saisissez l'e-mail et le mot de passe du
   compte PETLIBRO (de préférence le second compte, voir plus haut).
   Enregistrez.
3. Le statut indique « Connecté à PETLIBRO : 3 appareils ».
4. Ouvrez l'onglet **Découverte** et ajoutez les appareils à suivre. Leurs
   valeurs arrivent dès qu'ils sont ajoutés.

Le bouton **Tester la connexion** se reconnecte si besoin, lit le compte et
liste ses appareils.

## Boutons, interrupteurs et distribution depuis une scène

- **Distribuer maintenant** distribue le nombre de portions de l'option
  « Portions du bouton Distribuer » (1 par défaut, jusqu'à 10).
- L'action de scène **Distribuer avec un distributeur PETLIBRO** distribue
  n'importe quel nombre de portions : 1 à 48, 1 à 16 sur l'Air Smart Feeder.
  Un autre nombre échoue en indiquant la plage acceptée.
- **Programme de repas** active ou désactive le programme du distributeur ;
  **Pompe** démarre ou arrête la pompe d'une Dockstream 2. L'interrupteur
  affiche la valeur que PETLIBRO renvoie à la lecture suivante, 15 secondes
  après la commande.
- PETLIBRO refuse une commande quand l'appareil est hors ligne : le message
  d'erreur s'affiche dans Gladys.

Un repas demandé depuis Gladys ne déclenche pas « Repas distribué » : une
scène ne peut pas boucler dessus.

## Scènes

Deux déclencheurs de scène :

- **Repas distribué** : un distributeur a distribué un repas, depuis son
  programme, l'application ou son propre bouton. Variables `feeder_name`,
  `portions` et `at` (UTC). Le filtre peut viser un distributeur.
- **Alerte PETLIBRO** : un appareil commence à signaler un problème :
  croquettes bientôt épuisées, manque d'eau, batterie faible, déshydratant à
  remplacer, filtre à remplacer, nettoyage à faire (0 jour restant) ou une
  erreur de l'appareil. Le filtre peut viser un appareil et certaines alertes ;
  variables `device_name` et `message`. Une alerte se déclenche une fois quand
  elle commence, à nouveau seulement après avoir cessé.

La première lecture après un démarrage ne déclenche rien, et les repas de plus
de 15 minutes trouvés après une coupure sont seulement enregistrés. Les autres
valeurs (niveau d'eau %, batterie…) fonctionnent avec le déclencheur habituel
« Changement d'état d'un appareil » : pour une Dockstream de première
génération, qui ne donne pas de seuil d'eau basse, utilisez son niveau d'eau.

## Fréquence de lecture

Toutes les 2 minutes par défaut (60 à 900 secondes) : l'état de chaque
appareil, plus les repas du jour de chaque distributeur de croquettes et la
pompe et les abreuvements de chaque fontaine. La liste des repas elle-même
n'est lue que quand le compte du jour change, et au moins toutes les 30
minutes. La liste des appareils est relue toutes les 30 minutes et lors d'une
recherche dans Découverte. En cas d'erreur, l'intégration attend 1, 2, 5, 10
puis 15 minutes. Elle se connecte au plus une fois toutes les 15 minutes et
garde son jeton entre deux redémarrages.

## Options

| Option                              | Par défaut      | Rôle                                                                           |
| ----------------------------------- | --------------- | ------------------------------------------------------------------------------ |
| E-mail, mot de passe                | —               | un compte PETLIBRO, de préférence un second compte avec vos appareils partagés |
| Fuseau horaire des appareils        | celui de Gladys | PETLIBRO y compte les repas du jour (nom IANA)                                 |
| Intervalle de rafraîchissement (s)  | 120             | fréquence de lecture des appareils                                             |
| Portions du bouton Distribuer       | 1               | ce que distribue « Distribuer maintenant » (1 à 10)                            |
| Langue des noms des fonctionnalités | français        | noms des fonctionnalités et messages d'alerte                                  |

## Dépannage

- **« PETLIBRO a refusé la connexion »** : vérifiez l'e-mail et le mot de
  passe dans l'application PETLIBRO. L'intégration ne réessaie pas seule :
  elle attend une modification ou un clic sur **Tester la connexion**.
- **« PETLIBRO ne connaît aucun compte avec cet e-mail »** : vérifiez
  l'e-mail.
- **« PETLIBRO a refusé le jeton juste après la connexion »** : le même
  compte est connecté dans l'application PETLIBRO. Utilisez un second compte
  avec lequel vos appareils sont partagés.
- **Un appareil est `injoignable` avec un point orange** : PETLIBRO le signale
  hors ligne (Wi-Fi, alimentation). Vérifiez-le dans l'application.
- **Un modèle manque** : la litière et d'autres appareils ne sont pas encore
  pris en charge ; le bouton de test les compte. Ouvrez une issue sur le dépôt
  GitHub.

## Confidentialité

L'e-mail et le mot de passe sont stockés par Gladys comme secret (jamais
renvoyés au navigateur). L'intégration envoie l'e-mail et une empreinte MD5 du
mot de passe au serveur PETLIBRO (`api.us.petlibro.com`, celui que
l'application utilise dans tous les pays) pour ouvrir une session, comme le
fait l'application ; elle garde le jeton dans son dossier `/data`. PETLIBRO,
Granary et Dockstream sont des marques de leur propriétaire ; cette
intégration est sans lien avec PETLIBRO.
