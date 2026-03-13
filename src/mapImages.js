const IMAGE_BASE = 'https://raw.githubusercontent.com/heroespatchnotes/heroes-talents/master/images/maps';

// Map display names to their short/file names in the CDN
const MAP_NAMES = {
  'Alterac Pass': 'alteracpass',
  'Battlefield of Eternity': 'battlefieldofeternity',
  "Blackheart's Bay": 'blackheartsbay',
  'Braxis Holdout': 'braxisholdout',
  'Cursed Hollow': 'cursedhollow',
  'Dragon Shire': 'dragonshire',
  'Garden of Terror': 'gardenofterror',
  'Hanamura Temple': 'hanamurasimulator',
  'Infernal Shrines': 'infernalshrines',
  'Lost Cavern': 'lostcavern',
  'Sky Temple': 'skytemple',
  'Tomb of the Spider Queen': 'tombofthespiderqueen',
  'Towers of Doom': 'towersofdoom',
  'Volskaya Foundry': 'volskayafoundry',
  'Warhead Junction': 'warheadjunction',
};

function getMapImageUrl(mapName) {
  const key = MAP_NAMES[mapName];
  if (!key) return null;
  return `${IMAGE_BASE}/${key}.jpg`;
}

module.exports = { getMapImageUrl };
