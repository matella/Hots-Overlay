const https = require('https');
const { normalizeHeroName } = require('./heroNames');

const TALENT_REPO = 'https://raw.githubusercontent.com/heroespatchnotes/heroes-talents/master';
const IMAGE_BASE = TALENT_REPO + '/images/talents';

// talentTreeId -> { name, icon, type }
const talentMap = new Map();
// hero short name -> Promise (deduplicates concurrent loads, allows retry on failure)
const loadingPromises = new Map();

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function loadHero(heroName) {
  const short = normalizeHeroName(heroName);

  // Return existing promise if already loading/loaded
  if (loadingPromises.has(short)) return loadingPromises.get(short);

  const promise = (async () => {
    try {
      const data = await fetchJSON(TALENT_REPO + '/hero/' + short + '.json');
      for (const talents of Object.values(data.talents || {})) {
        for (const t of talents) {
          if (t.talentTreeId && t.icon) {
            talentMap.set(t.talentTreeId, {
              name: t.name || t.talentTreeId,
              icon: IMAGE_BASE + '/' + t.icon,
              type: t.type || null,
            });
          }
        }
      }
    } catch (err) {
      // Remove from cache so it can be retried on next request
      loadingPromises.delete(short);
      console.error('[talentIcons] Failed to load ' + short + ':', err.message);
    }
  })();

  loadingPromises.set(short, promise);
  return promise;
}

async function loadHeroesForMatch(heroNames) {
  await Promise.all(heroNames.map(h => loadHero(h)));
}

function resolveTalent(talent) {
  const info = talentMap.get(talent.name);
  return {
    tier: talent.tier,
    id: talent.name,
    name: info ? info.name : talent.name,
    icon: info ? info.icon : null,
    type: info ? info.type : null,
  };
}

module.exports = { loadHeroesForMatch, resolveTalent };
