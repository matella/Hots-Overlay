const IMAGE_BASE = 'https://raw.githubusercontent.com/heroespatchnotes/heroes-talents/master/images/heroes';

// Special cases where the normalizer doesn't produce the correct shortName
const OVERRIDES = {
  'The Lost Vikings': 'lostvikings',
};

function normalizeHeroName(displayName) {
  if (OVERRIDES[displayName]) return OVERRIDES[displayName];
  const short = displayName.replace(/[.'\- ]/g, '').toLowerCase();
  if (/[^a-z0-9]/.test(short)) {
    console.warn(`heroNames: unexpected chars in "${displayName}" -> "${short}". Add an OVERRIDE entry.`);
  }
  return short;
}

function getHeroImageUrl(displayName) {
  return `${IMAGE_BASE}/${normalizeHeroName(displayName)}.png`;
}

module.exports = { normalizeHeroName, getHeroImageUrl };
