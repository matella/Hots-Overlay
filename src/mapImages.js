// Map images served locally from public/images/maps/
const MAP_NAMES = {
  'Alterac Pass': 'alteracpass',
  'Battlefield of Eternity': 'battlefieldofeternity',
  "Blackheart's Bay": 'blackheartsbay',
  'Braxis Holdout': 'braxisholdout',
  'Cursed Hollow': 'cursedhollow',
  'Dragon Shire': 'dragonshire',
  'Garden of Terror': 'gardenofterror',
  'Hanamura Temple': 'hanamuratemple',
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
  return `/images/maps/${key}.webp`;
}

module.exports = { getMapImageUrl };
