// API Client for Deadlock Build Creator
// Uses the public Deadlock API directly

const API_BASE = 'https://api.deadlock-api.com/v1';
const ASSETS_BASE = 'https://assets.deadlock-api.com';

// Cache for items metadata
let itemsCache = null;

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
 * @returns {Promise<Array>}
 */
async function fetchItemStats(heroId, networthBucket) {
    const bucketParam = `net_worth_by_${networthBucket}`;
    const params = new URLSearchParams({
        hero_ids: heroId,
        bucket: bucketParam,
        min_matches: 30,
    });

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
 * @returns {Promise<Array>}
 */
async function fetchItemStatsByGameTime(heroId) {
    const params = new URLSearchParams({
        hero_ids: heroId,
        bucket: 'game_time_min',
        min_matches: 30,
    });

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
 * @returns {Promise<Object>} Build creator response with tiers
 */
async function fetchBuildCreatorItems(heroId) {
    // Fetch items metadata, networth stats, and game time stats in parallel
    // Use 1000 bucket size for most granular networth data
    const [itemsMetadata, stats, gameTimeStats] = await Promise.all([
        fetchItemsMetadata(),
        fetchItemStats(heroId, 1000),
        fetchItemStatsByGameTime(heroId),
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
 * API object for external use
 */
const API = {
    fetchHeroes,
    fetchItemsMetadata,
    fetchItemStats,
    fetchItemStatsByGameTime,
    fetchBuildCreatorItems,
};
