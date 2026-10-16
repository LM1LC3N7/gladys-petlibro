// -----------------------------------------------------------------------------
// Texts shown in Gladys (connection status, button, device and feature names,
// alerts), in English and French.
// -----------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The text of `texts` in `language`, English otherwise. */
export const word = (texts, language) => texts[language] ?? texts.en;

/** Feature names, in the language chosen in the configuration. */
export const FEATURE_NAMES = {
  online: { en: 'Online', fr: 'En ligne' },
  error: { en: 'Error', fr: 'Erreur' },
  battery: { en: 'Battery', fr: 'Batterie' },
  'battery-low': { en: 'Battery low', fr: 'Batterie faible' },
  charging: { en: 'Charging', fr: 'En charge' },
  mains: { en: 'On mains power', fr: 'Sur secteur' },
  // Feeders
  feed: { en: 'Feed now', fr: 'Distribuer maintenant' },
  'feeding-plan': { en: 'Feeding plan', fr: 'Programme de repas' },
  food: { en: 'Food level', fr: 'Niveau de croquettes' },
  'food-1': { en: 'Food level, hopper 1', fr: 'Niveau de croquettes, réservoir 1' },
  'food-2': { en: 'Food level, hopper 2', fr: 'Niveau de croquettes, réservoir 2' },
  'dispensed-today': {
    en: 'Dispensed today (portions)',
    fr: "Distribué aujourd'hui (portions)",
  },
  'feedings-today': { en: 'Meals today', fr: "Repas aujourd'hui" },
  'last-meal': { en: 'Last meal (portions)', fr: 'Dernier repas (portions)' },
  desiccant: { en: 'Desiccant', fr: 'Déshydratant' },
  'desiccant-days': { en: 'Desiccant (days left)', fr: 'Déshydratant (jours restants)' },
  'reset-desiccant': { en: 'Desiccant replaced', fr: 'Déshydratant remplacé' },
  temperature: { en: 'Temperature', fr: 'Température' },
  // Fountains
  pump: { en: 'Pump', fr: 'Pompe' },
  water: { en: 'Water', fr: 'Eau' },
  'water-level': { en: 'Water level', fr: "Niveau d'eau" },
  'water-left': { en: 'Water left', fr: 'Eau restante' },
  'drunk-today': { en: 'Drunk today', fr: "Bu aujourd'hui" },
  'drinks-today': { en: 'Drinks today', fr: "Abreuvements aujourd'hui" },
  filter: { en: 'Filter', fr: 'Filtre' },
  'filter-days': { en: 'Filter (days left)', fr: 'Filtre (jours restants)' },
  'reset-filter': { en: 'Filter replaced', fr: 'Filtre remplacé' },
  cleaning: { en: 'Cleaning', fr: 'Nettoyage' },
  'cleaning-days': { en: 'Next cleaning (days)', fr: 'Prochain nettoyage (jours)' },
  'reset-cleaning': { en: 'Cleaned', fr: 'Nettoyé' },
};

export const featureName = (role, language) => word(FEATURE_NAMES[role], language);

/** Alert labels (scene trigger select and the message variable). */
export const ALERT_NAMES = {
  low_food: { en: 'Food running low', fr: 'Croquettes bientôt épuisées' },
  low_water: { en: 'Water running low', fr: "Manque d'eau" },
  low_battery: { en: 'Battery low', fr: 'Batterie faible' },
  desiccant_change: { en: 'Desiccant to replace', fr: 'Déshydratant à remplacer' },
  filter_change: { en: 'Filter to replace', fr: 'Filtre à remplacer' },
  cleaning_due: { en: 'Cleaning due', fr: 'Nettoyage à faire' },
  device_error: { en: 'Device error', fr: "Erreur de l'appareil" },
};

export const NO_ERROR = { en: 'No error', fr: 'Aucune erreur' };

/** "25 min" / "3 h", for the pauses. */
export function age(ms) {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 120) {
    return { en: `${minutes} min`, fr: `${minutes} min` };
  }
  const hours = Math.round(minutes / 60);
  return { en: `${hours} h`, fr: `${hours} h` };
}

export const T = {
  noCredentials: {
    en: 'Enter the e-mail and password of a PETLIBRO account, preferably a second account your devices are shared with in the PETLIBRO app.',
    fr: "Saisissez l'e-mail et le mot de passe d'un compte PETLIBRO, de préférence un second compte avec lequel vos appareils sont partagés dans l'application PETLIBRO.",
  },
  connecting: {
    en: 'Signing in to PETLIBRO…',
    fr: 'Connexion à PETLIBRO…',
  },
  connected: ({ devices }) => ({
    en: `Connected to PETLIBRO: ${plural(devices, 'device', 'devices')}. Open Discovery to add them.`,
    fr: `Connecté à PETLIBRO : ${plural(devices, 'appareil', 'appareils')}. Ouvrez Découverte pour les ajouter.`,
  }),
  refused: (reason) => ({
    en: `PETLIBRO refused the sign-in: ${reason}. Check the e-mail and password in the configuration (the integration waits for a change).`,
    fr: `PETLIBRO a refusé la connexion : ${reason}. Vérifiez l'e-mail et le mot de passe dans la configuration (l'intégration attend une modification).`,
  }),
  unknownAccount: {
    en: 'PETLIBRO knows no account with this e-mail: check it in the configuration (the integration waits for a change).',
    fr: "PETLIBRO ne connaît aucun compte avec cet e-mail : vérifiez-le dans la configuration (l'intégration attend une modification).",
  },
  kicked: (wait) => ({
    en: `PETLIBRO refused the token right after the sign-in: this account is probably signed in to the PETLIBRO app too (one session per account). Use a second account your devices are shared with. Next try in ${wait.en}.`,
    fr: `PETLIBRO a refusé le jeton juste après la connexion : ce compte est sans doute aussi connecté dans l'application PETLIBRO (une session par compte). Utilisez un second compte avec lequel vos appareils sont partagés. Nouvel essai dans ${wait.fr}.`,
  }),
  kickedStop: {
    en: 'PETLIBRO keeps refusing the token: this account is signed in elsewhere (PETLIBRO app). Use a second account your devices are shared with, then save the configuration or click "Test the connection".',
    fr: 'PETLIBRO refuse sans cesse le jeton : ce compte est connecté ailleurs (application PETLIBRO). Utilisez un second compte avec lequel vos appareils sont partagés, puis enregistrez la configuration ou cliquez sur « Tester la connexion ».',
  },
  loginWait: (wait) => ({
    en: `The PETLIBRO session ended; signing in again in ${wait.en} (at most one sign-in every 15 minutes).`,
    fr: `La session PETLIBRO s'est terminée ; nouvelle connexion dans ${wait.fr} (au plus une connexion toutes les 15 minutes).`,
  }),
  unreachable: (reason, wait) => ({
    en: `PETLIBRO cannot be reached (${reason}). Next try in ${wait.en}.`,
    fr: `PETLIBRO est injoignable (${reason}). Nouvel essai dans ${wait.fr}.`,
  }),
  offline: {
    en: 'PETLIBRO reports this device offline.',
    fr: 'PETLIBRO signale cet appareil hors ligne.',
  },
  unknownDevice: {
    en: 'Unknown device: wait for the first reading of the account.',
    fr: 'Appareil inconnu : attendez la première lecture du compte.',
  },
  notFeeder: {
    en: 'This device is not a PETLIBRO dry food feeder.',
    fr: "Cet appareil n'est pas un distributeur de croquettes PETLIBRO.",
  },
  badPortions: (max) => ({
    en: `Number of portions not accepted by this feeder: 1 to ${max}.`,
    fr: `Nombre de portions refusé par ce distributeur : 1 à ${max}.`,
  }),
  test: {
    cooldown: {
      en: 'Already read less than 30 seconds ago.',
      fr: 'Déjà lu il y a moins de 30 secondes.',
    },
    summary: ({ devices }) => ({
      en: `${plural(devices, 'device', 'devices')}.`,
      fr: `${plural(devices, 'appareil', 'appareils')}.`,
    }),
    skipped: (count) =>
      count === 0
        ? { en: '', fr: '' }
        : {
            en: `${plural(count, 'device', 'devices')} not supported yet.`,
            fr: `${plural(count, 'appareil', 'appareils')} pas encore pris en charge.`,
          },
  },
};
