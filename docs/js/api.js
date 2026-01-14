// API Client for Deadlock Build Creator
// Uses the public Deadlock API directly

const API_BASE = 'https://api.deadlock-api.com/v1';
const ASSETS_BASE = 'https://assets.deadlock-api.com';

// Cache for items metadata
let itemsCache = null;

// Cache for hero data (includes abilities)
const heroDataCache = new Map();

// Cache for abilities data
let abilitiesCache = null;

// Cache for ranks data
let ranksCache = null;

// Cache for item synergies (keyed by hero+rank combo)
const synergyCache = new Map();

/**
 * Fetch all heroes from the assets API
 * @returns {Promise<Array<{id: number, name: string}>>}
 */
async function fetchHeroes() {
    const response = await fetch(`${ASSETS_BASE}/v2/heroes`);
    if (!response.ok) {
        throw new Error('Failed to fetch heroes');
    }
    return response.json();
}

/**
 * Fetch all ranks from the assets API
 * @returns {Promise<Array<{tier: number, name: string, images: Object}>>}
 */
async function fetchRanks() {
    if (ranksCache) return ranksCache;

    const response = await fetch(`${ASSETS_BASE}/v2/ranks`);
    if (!response.ok) {
        throw new Error('Failed to fetch ranks');
    }
    ranksCache = await response.json();
    return ranksCache;
}

/**
 * Fetch all items metadata from assets API
 * @returns {Promise<Array>}
 */
async function fetchItemsMetadata() {
    if (itemsCache) return itemsCache;

    const response = await fetch(`${ASSETS_BASE}/v2/items`);
    if (!response.ok) {
        throw new Error('Failed to fetch items');
    }
    itemsCache = await response.json();
    return itemsCache;
}

/**
 * Fetch item stats from the analytics API for a specific hero and networth bucket
 * @param {number} heroId
 * @param {number} networthBucket - e.g., 5000 for 5k buckets
 * @param {number|null} minBadge - Minimum badge level (0-116) for rank filtering
 * @param {number|null} maxBadge - Maximum badge level (0-116) for rank filtering
 * @returns {Promise<Array>}
 */
async function fetchItemStats(heroId, networthBucket, minBadge = null, maxBadge = null) {
    const bucketParam = `net_worth_by_${networthBucket}`;
    const params = new URLSearchParams({
        hero_ids: heroId,
        bucket: bucketParam,
        min_matches: 30,
    });

    if (minBadge !== null) params.append('min_average_badge', minBadge);
    if (maxBadge !== null) params.append('max_average_badge', maxBadge);

    const url = `${API_BASE}/analytics/item-stats?${params}`;
    console.log('Fetching:', url);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            const text = await response.text();
            console.error('API error:', response.status, text);
            throw new Error(`Failed to fetch item stats: ${response.status}`);
        }
        return response.json();
    } catch (err) {
        console.error('Fetch error:', err);
        throw err;
    }
}

/**
 * Fetch item stats bucketed by game time (per minute)
 * @param {number} heroId
 * @param {number|null} minBadge - Minimum badge level (0-116) for rank filtering
 * @param {number|null} maxBadge - Maximum badge level (0-116) for rank filtering
 * @returns {Promise<Array>}
 */
async function fetchItemStatsByGameTime(heroId, minBadge = null, maxBadge = null) {
    const params = new URLSearchParams({
        hero_ids: heroId,
        bucket: 'game_time_min',
        min_matches: 30,
    });

    if (minBadge !== null) params.append('min_average_badge', minBadge);
    if (maxBadge !== null) params.append('max_average_badge', maxBadge);

    const url = `${API_BASE}/analytics/item-stats?${params}`;
    console.log('Fetching game time stats:', url);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            const text = await response.text();
            console.error('API error:', response.status, text);
            throw new Error(`Failed to fetch game time stats: ${response.status}`);
        }
        return response.json();
    } catch (err) {
        console.error('Fetch error:', err);
        throw err;
    }
}

/**
 * Fetch build creator items for a specific hero
 * Aggregates data from multiple API calls
 * @param {number} heroId - The hero ID
 * @param {number|null} minBadge - Minimum badge level (0-116) for rank filtering
 * @param {number|null} maxBadge - Maximum badge level (0-116) for rank filtering
 * @returns {Promise<Object>} Build creator response with tiers
 */
async function fetchBuildCreatorItems(heroId, minBadge = null, maxBadge = null) {
    // Fetch items metadata, networth stats, and game time stats in parallel
    // Use 1000 bucket size for most granular networth data
    const [itemsMetadata, stats, gameTimeStats] = await Promise.all([
        fetchItemsMetadata(),
        fetchItemStats(heroId, 1000, minBadge, maxBadge),
        fetchItemStatsByGameTime(heroId, minBadge, maxBadge),
    ]);

    // Create item lookup map (only upgrades with tiers)
    const itemsMap = new Map();
    console.log('Total items from API:', itemsMetadata.length);
    const upgrades = itemsMetadata.filter(item => item.type === 'upgrade');
    console.log('Upgrade items:', upgrades.length);
    console.log('Sample item keys:', Object.keys(upgrades[0]));
    console.log('Sample item full:', JSON.stringify(upgrades[0], null, 2));

    upgrades
        .filter(item => item.item_tier)
        .forEach(item => {
            itemsMap.set(item.id, {
                id: item.id,
                name: item.name,
                tier: item.item_tier,
                slot: item.item_slot_type || null,
                image: item.shop_image || item.image || null,
            });
        });

    console.log('Items with tiers:', itemsMap.size);

    // Aggregate stats by item
    const aggregatedStats = new Map();

    function ensureItem(stat) {
        const itemMeta = itemsMap.get(stat.item_id);
        if (!itemMeta) return null;

        if (!aggregatedStats.has(stat.item_id)) {
            aggregatedStats.set(stat.item_id, {
                item_id: stat.item_id,
                name: itemMeta.name,
                tier: itemMeta.tier,
                slot: itemMeta.slot,
                image: itemMeta.image,
                matches_total: 0,
                avg_buy_time_s: 0,
                avg_sell_time_s: 0,
                avg_sell_time_relative: 0,
                winrates_by_networth: {},
                winrates_by_game_time: {},
            });
        }
        return aggregatedStats.get(stat.item_id);
    }

    function processNetworthStats(stats) {
        stats.forEach(stat => {
            const agg = ensureItem(stat);
            if (!agg) return;

            // Only add if this bucket has data
            if (stat.matches > 0) {
                const bucketKey = String(stat.bucket);
                const winrate = stat.wins / stat.matches;

                agg.winrates_by_networth[bucketKey] = {
                    winrate,
                    matches: stat.matches,
                    wins: stat.wins,
                };

                agg.matches_total += stat.matches;
                agg.avg_buy_time_s = stat.avg_buy_time_s;

                // Capture sell timing data (use latest value as approximation)
                if (stat.avg_sell_time_s) {
                    agg.avg_sell_time_s = stat.avg_sell_time_s;
                }
                if (stat.avg_sell_time_relative) {
                    agg.avg_sell_time_relative = stat.avg_sell_time_relative;
                }
            }
        });
    }

    function processGameTimeStats(stats) {
        stats.forEach(stat => {
            const agg = ensureItem(stat);
            if (!agg) return;

            // Only add if this bucket has data
            if (stat.matches > 0) {
                const bucketKey = String(stat.bucket); // minute value
                const winrate = stat.wins / stat.matches;

                agg.winrates_by_game_time[bucketKey] = {
                    winrate,
                    matches: stat.matches,
                    wins: stat.wins,
                };
            }
        });
    }

    // Process both networth and game time stats
    console.log('Networth stats count:', stats.length);
    console.log('Game time stats count:', gameTimeStats.length);
    processNetworthStats(stats);
    processGameTimeStats(gameTimeStats);

    // Group by tier
    const tiers = { '1': [], '2': [], '3': [], '4': [] };

    console.log('Aggregated stats count:', aggregatedStats.size);

    aggregatedStats.forEach(item => {
        const tierKey = String(item.tier);
        console.log('Item:', item.name, 'tier:', item.tier, 'tierKey:', tierKey);
        if (tiers[tierKey]) {
            tiers[tierKey].push(item);
        }
    });

    console.log('Tiers:', Object.keys(tiers).map(k => `${k}: ${tiers[k].length} items`));

    // Get hero name
    const heroes = await fetchHeroes();
    const hero = heroes.find(h => h.id === heroId);
    const heroName = hero ? hero.name : 'Unknown';

    return {
        hero_id: heroId,
        hero_name: heroName,
        tiers,
    };
}

/**
 * Build upgrade chains client-side from items metadata and win rate data
 * @param {Array} itemsMetadata - Items from assets API
 * @param {Object} itemData - Item data with win rates from fetchBuildCreatorItems
 * @returns {Object} Build path data with chains and standalone items
 */
function buildUpgradeChains(itemsMetadata, itemData) {
    // Create lookup maps
    const itemsByClassName = new Map();
    const itemsById = new Map();

    // Build maps from metadata
    itemsMetadata
        .filter(item => item.type === 'upgrade' && item.item_tier)
        .forEach(item => {
            const info = {
                id: item.id,
                name: item.name,
                class_name: item.class_name,
                tier: item.item_tier,
                cost: item.cost || [800, 1600, 3200, 6400][item.item_tier - 1],
                slot: item.item_slot_type || 'unknown',
                component_items: item.component_items || [],
                image: item.shop_image || item.image,
            };
            if (item.class_name) {
                itemsByClassName.set(item.class_name, info);
            }
            itemsById.set(item.id, info);
        });

    // Build upgrade graph: class_name -> [items that upgrade from it]
    const upgradesFrom = new Map();
    itemsByClassName.forEach((item, className) => {
        item.component_items.forEach(componentClassName => {
            if (!upgradesFrom.has(componentClassName)) {
                upgradesFrom.set(componentClassName, []);
            }
            upgradesFrom.get(componentClassName).push(className);
        });
    });

    // Get win rates from itemData
    const winRateMap = new Map();
    if (itemData && itemData.tiers) {
        Object.values(itemData.tiers).flat().forEach(item => {
            let totalWins = 0;
            let totalMatches = 0;
            Object.values(item.winrates_by_networth || {}).forEach(data => {
                totalWins += data.wins || 0;
                totalMatches += data.matches || 0;
            });
            if (totalMatches > 0) {
                winRateMap.set(item.item_id, {
                    winRate: totalWins / totalMatches,
                    matches: totalMatches,
                });
            }
        });
    }

    // Find all upgrade chains starting from T1 items
    const chains = [];
    itemsByClassName.forEach((item, className) => {
        if (item.tier !== 1) return;
        if (!upgradesFrom.has(className)) return; // No upgrades from this item

        // Trace chains using DFS
        const stack = [[item]];
        while (stack.length > 0) {
            const currentChain = stack.pop();
            const lastItem = currentChain[currentChain.length - 1];

            const nextClassNames = upgradesFrom.get(lastItem.class_name) || [];
            if (nextClassNames.length > 0) {
                nextClassNames.forEach(nextClassName => {
                    const nextItem = itemsByClassName.get(nextClassName);
                    if (nextItem) {
                        stack.push([...currentChain, nextItem]);
                    }
                });
            }

            // Save chain if it has more than just T1
            if (currentChain.length > 1) {
                const totalCost = currentChain.reduce((sum, i) => sum + (i.cost || 0), 0);

                // Calculate average win rate for items in chain
                let totalWr = 0;
                let wrCount = 0;
                currentChain.forEach(i => {
                    const wr = winRateMap.get(i.id);
                    if (wr) {
                        totalWr += wr.winRate;
                        wrCount++;
                    }
                });
                const avgWinRate = wrCount > 0 ? totalWr / wrCount : 0.5;
                const avgMatches = wrCount > 0 ?
                    currentChain.reduce((sum, i) => sum + (winRateMap.get(i.id)?.matches || 0), 0) / wrCount : 0;

                chains.push({
                    slot: currentChain[0].slot,
                    items: currentChain.map(i => ({
                        item_id: i.id,
                        name: i.name,
                        tier: i.tier,
                        cost: i.cost,
                        image: i.image,
                    })),
                    total_cost: totalCost,
                    win_rate: avgWinRate,
                    matches: Math.round(avgMatches),
                });
            }
        }
    });

    // Sort by win rate and select top chains (variety across slots)
    chains.sort((a, b) => b.win_rate - a.win_rate);

    const selectedChains = [];
    const slotsCount = { weapon: 0, vitality: 0, spirit: 0 };

    for (const chain of chains) {
        const slot = chain.slot;
        if ((slotsCount[slot] || 0) >= 2) continue;
        if (selectedChains.length >= 6) break;

        slotsCount[slot] = (slotsCount[slot] || 0) + 1;
        selectedChains.push(chain);
    }

    // Find standalone T1 items (no upgrades) with good win rates
    const itemsInChains = new Set();
    selectedChains.forEach(chain => {
        chain.items.forEach(item => itemsInChains.add(item.item_id));
    });

    const standaloneItems = [];
    itemsByClassName.forEach(item => {
        if (item.tier !== 1) return;
        if (upgradesFrom.has(item.class_name)) return; // Has upgrades
        if (itemsInChains.has(item.id)) return;

        const wr = winRateMap.get(item.id);
        if (wr && wr.matches >= 50) {
            standaloneItems.push({
                item_id: item.id,
                name: item.name,
                tier: item.tier,
                cost: item.cost,
                slot: item.slot,
                image: item.image,
                win_rate: wr.winRate,
                matches: wr.matches,
            });
        }
    });

    standaloneItems.sort((a, b) => b.win_rate - a.win_rate);

    // Get game time and networth win rate data from itemData
    const gameTimeWinRateMap = new Map();
    const networthWinRateMap = new Map();
    if (itemData && itemData.tiers) {
        Object.values(itemData.tiers).flat().forEach(item => {
            if (item.winrates_by_game_time) {
                gameTimeWinRateMap.set(item.item_id, item.winrates_by_game_time);
            }
            if (item.winrates_by_networth) {
                networthWinRateMap.set(item.item_id, item.winrates_by_networth);
            }
        });
    }

    // Calculate hero's powerspike (game time with highest win rate)
    function calculateHeroPowerspike() {
        const minuteStats = {};

        // Aggregate all item win rates by game minute
        if (itemData && itemData.tiers) {
            Object.values(itemData.tiers).flat().forEach(item => {
                Object.entries(item.winrates_by_game_time || {}).forEach(([min, data]) => {
                    if (!minuteStats[min]) minuteStats[min] = { wins: 0, matches: 0 };
                    minuteStats[min].wins += data.wins || 0;
                    minuteStats[min].matches += data.matches || 0;
                });
            });
        }

        // Find the 5-minute window with highest win rate
        const phases = [
            { name: '0-10', start: 0, end: 10 },
            { name: '10-15', start: 10, end: 15 },
            { name: '15-20', start: 15, end: 20 },
            { name: '20-25', start: 20, end: 25 },
            { name: '25-30', start: 25, end: 30 },
            { name: '30+', start: 30, end: 60 },
        ];

        let peakPhase = null;
        phases.forEach(phase => {
            let wins = 0, matches = 0;
            for (let m = phase.start; m < phase.end; m++) {
                if (minuteStats[m]) {
                    wins += minuteStats[m].wins;
                    matches += minuteStats[m].matches;
                }
            }
            if (matches >= 1000) {
                const winRate = wins / matches;
                if (!peakPhase || winRate > peakPhase.winRate) {
                    peakPhase = { ...phase, winRate, matches };
                }
            }
        });

        return peakPhase;
    }

    // Determine item's soul bracket based on when it's typically purchased
    function getItemSoulBracket(itemId) {
        const networthData = networthWinRateMap.get(itemId);
        if (!networthData) return null;

        // Find the networth bucket with most matches (peak purchase time)
        const buckets = Object.entries(networthData)
            .map(([k, v]) => ({ networth: parseInt(k), matches: v.matches || 0 }))
            .filter(b => !isNaN(b.networth) && b.matches >= 100)
            .sort((a, b) => b.matches - a.matches);

        if (buckets.length === 0) return null;

        const peakNetworth = buckets[0].networth;

        // Map to soul brackets
        if (peakNetworth < 5000) return '0-5k';
        if (peakNetworth < 10000) return '5-10k';
        if (peakNetworth < 20000) return '10-20k';
        return '20k+';
    }

    // Get win rate at hero's powerspike timing
    function getPowerspikeWinRate(gameTimeData, psStart, psEnd) {
        let wins = 0, matches = 0;
        Object.entries(gameTimeData).forEach(([minStr, data]) => {
            const min = parseInt(minStr, 10);
            if (!isNaN(min) && min >= psStart && min < psEnd) {
                wins += data.wins || 0;
                matches += data.matches || 0;
            }
        });
        return matches >= 500 ? { winRate: wins / matches, matches } : null;
    }

    // Calculate hero's powerspike
    const powerspike = calculateHeroPowerspike();
    const psStart = powerspike?.start || 20;
    const psEnd = powerspike?.end || 60;

    console.log('Hero powerspike:', powerspike);

    // Build all items with powerspike win rates and soul brackets
    const allItems = [];
    itemsByClassName.forEach(item => {
        const overallWr = winRateMap.get(item.id);
        if (!overallWr || overallWr.matches < 100) return;

        const gameTimeData = gameTimeWinRateMap.get(item.id) || {};
        const psWr = getPowerspikeWinRate(gameTimeData, psStart, psEnd);

        // Only include items with good sample at powerspike timing
        if (!psWr) return;

        const soulBracket = getItemSoulBracket(item.id);
        if (!soulBracket) return;

        allItems.push({
            item_id: item.id,
            name: item.name,
            tier: item.tier,
            cost: item.cost,
            slot: item.slot,
            image: item.image,
            powerspike_win_rate: psWr.winRate,
            powerspike_matches: psWr.matches,
            soul_bracket: soulBracket,
        });
    });

    // Sort ALL items by powerspike win rate
    allItems.sort((a, b) => b.powerspike_win_rate - a.powerspike_win_rate);

    // Group by SOUL BRACKET, not tier (allows T3 rushes like Tesla Bullets)
    const bracket_0_5k = allItems.filter(item => item.soul_bracket === '0-5k').slice(0, 4);
    const bracket_5_10k = allItems.filter(item => item.soul_bracket === '5-10k').slice(0, 4);
    const bracket_10_20k = allItems.filter(item => item.soul_bracket === '10-20k').slice(0, 4);
    const bracket_20k_plus = allItems.filter(item => item.soul_bracket === '20k+').slice(0, 4);

    console.log('Soul bracket items:', {
        '0-5k': bracket_0_5k.map(i => i.name),
        '5-10k': bracket_5_10k.map(i => i.name),
        '10-20k': bracket_10_20k.map(i => i.name),
        '20k+': bracket_20k_plus.map(i => i.name),
    });

    // Build phases structure with soul brackets
    const build_phases = {
        '0-5k': {
            label: '0-5k Souls',
            description: 'Starting items',
            items: bracket_0_5k,
        },
        '5-10k': {
            label: '5-10k Souls',
            description: 'First power spike',
            items: bracket_5_10k,
        },
        '10-20k': {
            label: '10-20k Souls',
            description: 'Mid game core',
            items: bracket_10_20k,
        },
        '20k+': {
            label: '20k+ Souls',
            description: 'Late game',
            items: bracket_20k_plus,
        },
    };

    return {
        recommended_chains: selectedChains,
        standalone_items: standaloneItems.slice(0, 4),
        build_phases: build_phases,
        powerspike: powerspike,
    };
}

/**
 * Fetch detailed hero data including abilities
 * @param {number} heroId - The hero ID
 * @returns {Promise<Object>} Hero data with abilities
 */
async function fetchHeroData(heroId) {
    if (heroDataCache.has(heroId)) {
        return heroDataCache.get(heroId);
    }

    const response = await fetch(`${ASSETS_BASE}/v2/heroes/${heroId}`);
    if (!response.ok) {
        throw new Error(`Failed to fetch hero data: ${response.status}`);
    }

    const data = await response.json();
    heroDataCache.set(heroId, data);
    return data;
}

/**
 * Fetch all abilities (items with type=ability)
 * @returns {Promise<Array>} Array of ability items
 */
async function fetchAbilities() {
    if (abilitiesCache) return abilitiesCache;

    const response = await fetch(`${ASSETS_BASE}/v2/items?type=ability`);
    if (!response.ok) {
        throw new Error(`Failed to fetch abilities: ${response.status}`);
    }

    abilitiesCache = await response.json();
    return abilitiesCache;
}

/**
 * Fetch ability order stats for a specific hero
 * @param {number} heroId - The hero ID
 * @returns {Promise<Array>} Array of ability order sequences with stats
 */
async function fetchAbilityStats(heroId) {
    const params = new URLSearchParams({
        hero_id: heroId,
        min_matches: 100,
    });

    const url = `${API_BASE}/analytics/ability-order-stats?${params}`;
    console.log('Fetching ability stats:', url);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            const text = await response.text();
            console.error('API error:', response.status, text);
            throw new Error(`Failed to fetch ability stats: ${response.status}`);
        }
        return response.json();
    } catch (err) {
        console.error('Fetch error:', err);
        throw err;
    }
}

/**
 * Fetch item synergy (co-purchase) stats for a specific hero
 * @param {number} heroId - The hero ID
 * @param {number|null} minBadge - Minimum badge level (0-116) for rank filtering
 * @param {number|null} maxBadge - Maximum badge level (0-116) for rank filtering
 * @returns {Promise<Array>} Array of item pairs with win rates
 */
async function fetchItemSynergies(heroId, minBadge = null, maxBadge = null) {
    const cacheKey = `${heroId}-${minBadge}-${maxBadge}`;
    if (synergyCache.has(cacheKey)) {
        return synergyCache.get(cacheKey);
    }

    const params = new URLSearchParams({
        hero_ids: heroId,
        comb_size: 2,
        min_matches: 100,
    });

    if (minBadge !== null) params.append('min_average_badge', minBadge);
    if (maxBadge !== null) params.append('max_average_badge', maxBadge);

    const url = `${API_BASE}/analytics/item-permutation-stats?${params}`;
    console.log('Fetching item synergies:', url);

    try {
        const response = await fetch(url);
        if (!response.ok) {
            const text = await response.text();
            console.error('API error:', response.status, text);
            throw new Error(`Failed to fetch item synergies: ${response.status}`);
        }
        const data = await response.json();
        synergyCache.set(cacheKey, data);
        return data;
    } catch (err) {
        console.error('Fetch error:', err);
        throw err;
    }
}

/**
 * Build a synergy lookup map from raw permutation data
 * @param {Array} permutationData - Raw data from fetchItemSynergies
 * @returns {Map<number, Array>} Map of itemId -> [{pairedItemId, winRate, matches}, ...]
 */
function buildSynergyMap(permutationData) {
    const synergyMap = new Map();

    permutationData.forEach(perm => {
        const itemIds = perm.item_ids || [];
        if (itemIds.length !== 2) return;

        const [item1, item2] = itemIds;
        const matches = perm.matches || 0;
        const wins = perm.wins || 0;
        if (matches === 0) return;

        const winRate = wins / matches;

        // Add bidirectional synergy entries
        if (!synergyMap.has(item1)) synergyMap.set(item1, []);
        if (!synergyMap.has(item2)) synergyMap.set(item2, []);

        synergyMap.get(item1).push({
            itemId: item2,
            winRate,
            matches,
        });
        synergyMap.get(item2).push({
            itemId: item1,
            winRate,
            matches,
        });
    });

    // Sort each item's synergies by win rate descending
    synergyMap.forEach((synergies) => {
        synergies.sort((a, b) => b.winRate - a.winRate);
    });

    return synergyMap;
}

/**
 * Clear synergy cache (call when rank filter changes)
 */
function clearSynergyCache() {
    synergyCache.clear();
}

/**
 * API object for external use
 */
const API = {
    fetchHeroes,
    fetchRanks,
    fetchHeroData,
    fetchAbilities,
    fetchItemsMetadata,
    fetchItemStats,
    fetchItemStatsByGameTime,
    fetchBuildCreatorItems,
    buildUpgradeChains,
    fetchAbilityStats,
    fetchItemSynergies,
    buildSynergyMap,
    clearSynergyCache,
};
