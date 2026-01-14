// UI Components for Deadlock Build Creator

/**
 * Find the best networth bracket for an item
 * Returns the bucket with highest winrate and the range where it's strong
 * @param {Object} winratesByNetworth
 * @returns {{bucket: number, winrate: number, matches: number, rangeStart: number, rangeEnd: number}|null}
 */
function findBestBucket(winratesByNetworth, totalMatches) {
    // Consider buckets with >= 5% of total matches OR >= 1000 absolute matches
    const minPercentage = 0.05;
    const percentageMin = totalMatches * minPercentage;
    const absoluteMin = 1000;

    const buckets = Object.entries(winratesByNetworth)
        .map(([key, data]) => ({
            bucket: parseInt(key, 10),
            winrate: data?.winrate || 0,
            matches: data?.matches || 0
        }))
        .filter(b => !isNaN(b.bucket) && (b.matches >= percentageMin || b.matches >= absoluteMin))
        .sort((a, b) => a.bucket - b.bucket);

    if (buckets.length === 0) return null;

    // Find the bucket with highest winrate
    let best = buckets[0];
    for (const b of buckets) {
        if (b.winrate > best.winrate) {
            best = b;
        }
    }

    // Find the range where winrate is within 1% of best
    const threshold = best.winrate - 0.01;
    let rangeStart = best.bucket;
    let rangeEnd = best.bucket;

    for (const b of buckets) {
        if (b.winrate >= threshold) {
            if (b.bucket < rangeStart) rangeStart = b.bucket;
            if (b.bucket > rangeEnd) rangeEnd = b.bucket;
        }
    }

    return {
        bucket: best.bucket,
        winrate: best.winrate,
        matches: best.matches,
        rangeStart,
        rangeEnd
    };
}

/**
 * Get sample size class for color coding
 * @param {number} matches
 * @returns {string} CSS class
 */
function getSampleSizeClass(matches) {
    if (matches < 500) return 'sample-low';
    if (matches < 2000) return 'sample-medium';
    return 'sample-good';
}

/**
 * Create an item card element showing all networth brackets
 * @param {Object} item - The item data
 * @param {Map|null} synergyMap - Optional synergy map for showing paired items
 * @param {Map|null} itemImagesMap - Optional item images map for synergy icons
 * @returns {HTMLElement}
 */
function createItemCard(item, synergyMap = null, itemImagesMap = null) {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.dataset.itemId = item.item_id;

    // Get total matches first (needed for percentage-based filtering)
    const totalMatches = item.matches_total || 0;

    // Find the best networth bracket for this item
    const bestBucket = findBestBucket(item.winrates_by_networth, totalMatches);

    // Get overall winrate (weighted average)
    let overallWinrate = 0;
    if (totalMatches > 0) {
        let totalWins = 0;
        for (const data of Object.values(item.winrates_by_networth)) {
            totalWins += data.wins || 0;
        }
        overallWinrate = totalWins / totalMatches;
    }

    // Determine overall winrate class
    let overallClass = 'neutral';
    if (overallWinrate > 0.52) overallClass = 'positive';
    else if (overallWinrate < 0.48) overallClass = 'negative';

    // Create networth breakdown rows (pass total matches for percentage filtering)
    const bucketRows = createBucketRows(item.winrates_by_networth, bestBucket?.bucket, totalMatches);

    // Sample size color coding based on best bucket (not total)
    const bestBucketMatches = getBestBucketMatches(item);
    const sampleClass = getSampleSizeClass(bestBucketMatches);

    const imageHtml = item.image
        ? `<img class="item-image" src="${item.image}" alt="${escapeHtml(item.name)}" loading="lazy">`
        : '';

    // Calculate average souls at purchase from bucket data
    const avgSouls = calculateAvgSouls(item.winrates_by_networth);

    // Format sell timing if available
    const sellTimeHtml = item.avg_sell_time_s > 0
        ? `<span class="item-sell-time">Sell: ${formatTime(item.avg_sell_time_s)} (${Math.round(item.avg_sell_time_relative)}%)</span>`
        : '';

    // Create synergy badges if synergy data is available
    const synergyHtml = (synergyMap && itemImagesMap)
        ? createSynergyBadges(item.item_id, synergyMap, itemImagesMap)
        : '';

    card.innerHTML = `
        <div class="item-header">
            ${imageHtml}
            <span class="item-name">${escapeHtml(item.name)}</span>
            <span class="item-winrate ${overallClass}">${formatPercent(overallWinrate)}</span>
        </div>
        ${synergyHtml}
        <div class="item-buckets">
            ${bucketRows}
        </div>
        <div class="item-footer">
            <span class="item-avg-souls">Avg souls: ${formatSouls(avgSouls)}</span>
            ${sellTimeHtml}
            <span class="item-matches ${sampleClass}">${formatNumber(totalMatches)} total</span>
        </div>
    `;

    return card;
}

/**
 * Create a compact icon-only card for condensed view
 * @param {Object} item - The item data
 * @returns {HTMLElement}
 */
function createIconCard(item) {
    const card = document.createElement('div');
    card.className = 'icon-card';
    card.dataset.itemId = item.item_id;

    // Calculate overall winrate for tooltip
    const totalMatches = item.matches_total || 0;
    let overallWinrate = 0;
    if (totalMatches > 0) {
        let totalWins = 0;
        for (const data of Object.values(item.winrates_by_networth)) {
            totalWins += data.wins || 0;
        }
        overallWinrate = totalWins / totalMatches;
    }

    const tooltipText = `${item.name} - ${formatPercent(overallWinrate)}`;

    if (item.image) {
        card.innerHTML = `<img src="${item.image}" alt="${escapeHtml(item.name)}" title="${escapeHtml(tooltipText)}">`;
    } else {
        card.textContent = item.name.substring(0, 2);
        card.title = tooltipText;
    }

    return card;
}

/**
 * Create bucket rows showing winrate at each networth bracket
 * @param {Object} winratesByNetworth
 * @param {number|null} bestBucket - The best bucket to highlight
 * @returns {string} HTML string
 */
function createBucketRows(winratesByNetworth, bestBucket, totalMatches) {
    // Show buckets with >= 5% of total matches OR >= 1000 absolute matches
    const minPercentage = 0.05;
    const percentageMin = totalMatches * minPercentage;
    const absoluteMin = 1000;

    const buckets = Object.entries(winratesByNetworth)
        .map(([key, data]) => ({
            networth: parseInt(key, 10),
            winrate: data.winrate,
            matches: data.matches
        }))
        .filter(b => !isNaN(b.networth) && (b.matches >= percentageMin || b.matches >= absoluteMin))
        .sort((a, b) => a.networth - b.networth);

    if (buckets.length === 0) {
        return '<div class="bucket-row">Insufficient data</div>';
    }

    return buckets.map(b => {
        const isBest = b.networth === bestBucket;
        const sampleClass = getSampleSizeClass(b.matches);

        let winrateClass = 'neutral';
        if (b.winrate > 0.52) winrateClass = 'positive';
        else if (b.winrate < 0.48) winrateClass = 'negative';

        const label = b.networth === 0 ? '0-1k' :
                      b.networth >= 10000 ? `${b.networth/1000}k+` :
                      `${b.networth/1000}k`;

        return `
            <div class="bucket-row ${isBest ? 'best' : ''}">
                <span class="bucket-label">${label}</span>
                <span class="bucket-winrate ${winrateClass}">${formatPercent(b.winrate)}</span>
                <span class="bucket-matches ${sampleClass}">(${formatNumber(b.matches)})</span>
            </div>
        `;
    }).join('');
}

/**
 * Find the best matching bucket key for a given networth
 * The API returns buckets like 0, 5000, 10000, etc.
 * @param {Object} winratesByNetworth
 * @param {number} targetNetworth
 * @returns {string|null}
 */
function findBucketKey(winratesByNetworth, targetNetworth) {
    // Try exact match first
    if (winratesByNetworth[String(targetNetworth)]) {
        return String(targetNetworth);
    }

    // Find the closest bucket that's <= targetNetworth
    const keys = Object.keys(winratesByNetworth)
        .map(k => parseInt(k, 10))
        .filter(k => !isNaN(k))
        .sort((a, b) => a - b);

    // Find bucket closest to target
    let bestKey = null;
    for (const key of keys) {
        if (key <= targetNetworth + 2500) { // Allow some tolerance
            bestKey = String(key);
        }
    }
    return bestKey;
}

/**
 * Create sparkline HTML for winrate trend
 * @param {Object} winratesByNetworth - Winrate data by networth
 * @param {number} selectedNetworth - Currently highlighted networth
 * @returns {string} HTML string
 */
function createSparklineData(winratesByNetworth, selectedNetworth) {
    // API supports: 0, 1000, 2000, 3000, 5000, 10000
    const displayBuckets = [0, 1000, 2000, 3000, 5000, 10000];
    const maxHeight = 20;

    // Get all available data points
    const dataPoints = [];
    for (const bucket of displayBuckets) {
        const key = findBucketKey(winratesByNetworth, bucket);
        const data = key ? winratesByNetworth[key] : null;
        dataPoints.push({ bucket, data, key });
    }

    // Get min/max winrates for scaling
    let minWr = 1, maxWr = 0;
    dataPoints.forEach(({ data }) => {
        if (data && data.winrate) {
            minWr = Math.min(minWr, data.winrate);
            maxWr = Math.max(maxWr, data.winrate);
        }
    });

    // Handle case where all winrates are the same
    if (maxWr - minWr < 0.01) {
        minWr = Math.max(0, maxWr - 0.05);
    }

    return dataPoints.map(({ bucket, data }) => {
        if (!data || !data.matches) {
            return `<div class="sparkline-bar" style="height: 4px;" title="${formatNetworth(bucket)}: No data"></div>`;
        }

        // Scale height between 4px and maxHeight
        const normalized = maxWr > minWr ? (data.winrate - minWr) / (maxWr - minWr) : 0.5;
        const height = 4 + (normalized * (maxHeight - 4));
        const isHighlight = bucket === selectedNetworth;

        return `<div class="sparkline-bar ${isHighlight ? 'highlight' : ''}"
                     style="height: ${height}px;"
                     title="${formatNetworth(bucket)}: ${formatPercent(data.winrate)} (${formatNumber(data.matches)} matches)">
                </div>`;
    }).join('');
}

/**
 * Create modal stats content
 * @param {Object} item - The item data
 * @returns {string} HTML string
 */
function createModalStats(item) {
    const displayBuckets = [0, 1000, 2000, 3000, 5000, 10000];

    let html = '';

    displayBuckets.forEach(bucket => {
        const bucketKey = findBucketKey(item.winrates_by_networth, bucket);
        const data = bucketKey ? item.winrates_by_networth[bucketKey] : null;
        const winrate = data ? data.winrate : 0;
        const matches = data ? data.matches : 0;

        let winrateClass = '';
        if (winrate > 0.52) winrateClass = 'positive';
        else if (winrate < 0.48) winrateClass = 'negative';

        html += `
            <div class="stat-row">
                <span class="stat-label">${formatNetworth(bucket)}</span>
                <span class="stat-value ${winrateClass}">${formatPercent(winrate)} <small>(${formatNumber(matches)})</small></span>
            </div>
        `;
    });

    const avgSouls = calculateAvgSouls(item.winrates_by_networth);

    html += `
        <div class="stat-row">
            <span class="stat-label">Avg Souls</span>
            <span class="stat-value">${formatSouls(avgSouls)}</span>
        </div>
        <div class="stat-row">
            <span class="stat-label">Total Matches</span>
            <span class="stat-value">${formatNumber(item.matches_total)}</span>
        </div>
    `;

    // Add sell timing if available
    if (item.avg_sell_time_s > 0) {
        html += `
            <div class="stat-row">
                <span class="stat-label">Avg Sell Time</span>
                <span class="stat-value">${formatTime(item.avg_sell_time_s)}</span>
            </div>
            <div class="stat-row">
                <span class="stat-label">Sell Point</span>
                <span class="stat-value">${Math.round(item.avg_sell_time_relative)}% of match</span>
            </div>
        `;
    }

    return html;
}

/**
 * Create a build slot element
 * @param {Object|null} item - The item in the slot, or null if empty
 * @param {number} slotIndex - The slot index
 * @returns {HTMLElement}
 */
function createBuildSlot(item, slotIndex) {
    const slot = document.createElement('div');
    slot.className = `build-slot ${item ? 'filled' : 'empty'}`;
    slot.dataset.slot = slotIndex;

    if (item) {
        slot.dataset.itemId = item.item_id;
        const imageHtml = item.image
            ? `<img class="slot-image" src="${item.image}" alt="${escapeHtml(item.name)}" title="${escapeHtml(item.name)}">`
            : `<span class="slot-name">${escapeHtml(item.name)}</span>`;
        slot.innerHTML = `
            ${imageHtml}
            <span class="slot-remove">&times;</span>
        `;
    }

    return slot;
}

/**
 * Get the best bucket match count for an item (highest individual bucket)
 * This is more meaningful than total since total spreads across many buckets
 */
function getBestBucketMatches(item) {
    let maxMatches = 0;
    for (const data of Object.values(item.winrates_by_networth)) {
        if (data.matches > maxMatches) {
            maxMatches = data.matches;
        }
    }
    return maxMatches;
}

/**
 * Get sort function based on sortBy parameter
 * @param {string} sortBy - 'winrate', 'popularity', or 'buy_order'
 * @returns {function} Comparator function
 */
function getSortFunction(sortBy) {
    switch (sortBy) {
        case 'popularity':
            return (a, b) => b.matches_total - a.matches_total;
        case 'buy_order':
            return (a, b) => a.avg_buy_time_s - b.avg_buy_time_s;
        case 'winrate':
        default:
            return (a, b) => {
                const wrA = calculateOverallWinrate(a.winrates_by_networth);
                const wrB = calculateOverallWinrate(b.winrates_by_networth);
                return wrB - wrA;
            };
    }
}

/**
 * Render items into a tier column, grouped by sample size quality
 * @param {string} tierId - The tier number (1-4)
 * @param {Array} items - Array of items for this tier
 * @param {string} sortBy - Sort method: 'winrate', 'popularity', or 'buy_order'
 * @param {Map|null} synergyMap - Optional synergy map for showing paired items
 * @param {Map|null} itemImagesMap - Optional item images map for synergy icons
 */
function renderTierItems(tierId, items, sortBy = 'winrate', synergyMap = null, itemImagesMap = null) {
    const container = document.getElementById(`tier-${tierId}-items`);
    if (!container) return;

    // Group items by BEST BUCKET sample size (not total)
    // This reflects actual data quality per networth bracket
    const greenItems = [];  // Best bucket has 2000+ matches
    const yellowItems = []; // Best bucket has 500-2000 matches
    const redItems = [];    // Best bucket has <500 matches

    items.forEach(item => {
        const bestBucketMatches = getBestBucketMatches(item);
        if (bestBucketMatches >= 2000) {
            greenItems.push(item);
        } else if (bestBucketMatches >= 500) {
            yellowItems.push(item);
        } else {
            redItems.push(item);
        }
    });

    // Sort each group based on sortBy parameter
    const sortFn = getSortFunction(sortBy);
    greenItems.sort(sortFn);
    yellowItems.sort(sortFn);
    redItems.sort(sortFn);

    container.innerHTML = '';

    // Render green items
    if (greenItems.length > 0) {
        greenItems.forEach(item => {
            container.appendChild(createItemCard(item, synergyMap, itemImagesMap));
        });
    }

    // Separator and yellow items
    if (yellowItems.length > 0) {
        if (greenItems.length > 0) {
            container.appendChild(createSeparator('Limited Data'));
        }
        yellowItems.forEach(item => {
            container.appendChild(createItemCard(item, synergyMap, itemImagesMap));
        });
    }

    // Separator and red items
    if (redItems.length > 0) {
        if (greenItems.length > 0 || yellowItems.length > 0) {
            container.appendChild(createSeparator('Low Sample Size'));
        }
        redItems.forEach(item => {
            container.appendChild(createItemCard(item, synergyMap, itemImagesMap));
        });
    }
}

/**
 * Create a separator element
 * @param {string} label - Label for the separator
 * @returns {HTMLElement}
 */
function createSeparator(label) {
    const sep = document.createElement('div');
    sep.className = 'tier-separator';
    sep.innerHTML = `<span>${label}</span>`;
    return sep;
}

/**
 * Calculate overall weighted winrate
 */
function calculateOverallWinrate(winratesByNetworth) {
    let totalWins = 0;
    let totalMatches = 0;
    for (const data of Object.values(winratesByNetworth)) {
        totalWins += data.wins || 0;
        totalMatches += data.matches || 0;
    }
    return totalMatches > 0 ? totalWins / totalMatches : 0;
}

/**
 * Calculate average souls at purchase (weighted by matches in each bucket)
 * Bucket midpoints: 0→500, 1k→1.5k, 2k→2.5k, 3k→4k, 5k→7.5k, 10k→15k
 */
function calculateAvgSouls(winratesByNetworth) {
    const bucketMidpoints = {
        '0': 500,
        '1000': 1500,
        '2000': 2500,
        '3000': 4000,
        '5000': 7500,
        '10000': 15000,
    };

    let weightedSum = 0;
    let totalMatches = 0;

    for (const [bucket, data] of Object.entries(winratesByNetworth)) {
        const midpoint = bucketMidpoints[bucket];
        if (midpoint && data.matches) {
            weightedSum += midpoint * data.matches;
            totalMatches += data.matches;
        }
    }

    return totalMatches > 0 ? weightedSum / totalMatches : 0;
}

/**
 * Format souls value
 */
function formatSouls(souls) {
    if (souls >= 1000) {
        return `${(souls / 1000).toFixed(1)}k`;
    }
    return Math.round(souls).toString();
}

/**
 * Render build slots
 * @param {Array} buildItems - Array of items in the build (can have nulls)
 */
function renderBuildSlots(buildItems) {
    const container = document.getElementById('build-slots');
    if (!container) return;

    container.innerHTML = '';
    for (let i = 0; i < 12; i++) {
        const item = buildItems[i] || null;
        const slot = createBuildSlot(item, i);
        container.appendChild(slot);
    }
}

// Utility functions

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatPercent(value) {
    return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(num) {
    if (num >= 1000000) {
        return `${(num / 1000000).toFixed(1)}M`;
    }
    if (num >= 1000) {
        return `${(num / 1000).toFixed(1)}k`;
    }
    return num.toString();
}

function formatNetworth(value) {
    if (value === 0) {
        return '0-1k';
    }
    if (value >= 10000) {
        return '10k+';
    }
    return `${value / 1000}k`;
}

function formatNetworthPrecise(value) {
    if (value === 0) {
        return '0';
    }
    return `${value / 1000}k`;
}

function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Game Time Phase Functions

/**
 * Group minute-level data into game phases
 * @param {Object} winratesByGameTime - Object with minute keys (0-30+)
 * @returns {Object} - Stats grouped by phase with winrate calculated
 */
function groupByGamePhase(winratesByGameTime) {
    const phases = {
        '0-5': { wins: 0, matches: 0, winrate: 0 },      // minutes 0-4
        '5-10': { wins: 0, matches: 0, winrate: 0 },     // minutes 5-9
        '10-20': { wins: 0, matches: 0, winrate: 0 },    // minutes 10-19
        '20-30': { wins: 0, matches: 0, winrate: 0 },    // minutes 20-29
        '30+': { wins: 0, matches: 0, winrate: 0 },      // minutes 30+
    };

    Object.entries(winratesByGameTime).forEach(([minuteStr, data]) => {
        const minute = parseInt(minuteStr, 10);
        if (isNaN(minute)) return;

        let phaseKey;
        if (minute < 5) phaseKey = '0-5';
        else if (minute < 10) phaseKey = '5-10';
        else if (minute < 20) phaseKey = '10-20';
        else if (minute < 30) phaseKey = '20-30';
        else phaseKey = '30+';

        phases[phaseKey].wins += data.wins || 0;
        phases[phaseKey].matches += data.matches || 0;
    });

    // Calculate winrates
    Object.keys(phases).forEach(key => {
        const p = phases[key];
        p.winrate = p.matches > 0 ? p.wins / p.matches : 0;
    });

    return phases;
}

/**
 * Find the best game phase for an item (highest winrate with sufficient data)
 * @param {Object} phases - Result of groupByGamePhase()
 * @param {number} totalMatches - Total matches across all phases
 * @returns {{phase: string, winrate: number, matches: number}|null}
 */
function findBestGamePhase(phases, totalMatches) {
    const minPercentage = 0.05;
    const percentageMin = totalMatches * minPercentage;
    const absoluteMin = 500;

    let best = null;
    for (const [phase, data] of Object.entries(phases)) {
        if (data.matches >= percentageMin || data.matches >= absoluteMin) {
            if (!best || data.winrate > best.winrate) {
                best = { phase, winrate: data.winrate, matches: data.matches };
            }
        }
    }
    return best;
}

// Timeline functions

/**
 * Find the optimal purchase window for an item
 * Window = contiguous range around the peak where winrate stays good
 */
function findPurchaseWindow(item) {
    const buckets = Object.entries(item.winrates_by_networth)
        .map(([k, v]) => ({
            networth: parseInt(k, 10),
            winrate: v.winrate,
            matches: v.matches
        }))
        .filter(b => !isNaN(b.networth) && b.matches >= 500)
        .sort((a, b) => a.networth - b.networth);

    if (buckets.length === 0) return null;

    // Only consider buckets up to 25k for finding the peak
    // Late game data (30k+) has survivorship bias and isn't useful for purchase timing
    const maxNetworthForPeak = 25000;
    const relevantBuckets = buckets.filter(b => b.networth <= maxNetworthForPeak);

    // If no relevant buckets, fall back to all buckets
    const searchBuckets = relevantBuckets.length > 0 ? relevantBuckets : buckets;

    // Find the peak bucket (highest winrate) within relevant range
    let peakIndex = 0;
    for (let i = 1; i < searchBuckets.length; i++) {
        if (searchBuckets[i].winrate > searchBuckets[peakIndex].winrate) {
            peakIndex = i;
        }
    }

    const peak = searchBuckets[peakIndex];

    // Find this peak in the full buckets array for expansion
    const fullPeakIndex = buckets.findIndex(b => b.networth === peak.networth);

    const threshold = peak.winrate - 0.03; // Window includes buckets within 3% of peak

    // Expand left from peak while winrate stays above threshold
    let startIndex = fullPeakIndex;
    while (startIndex > 0 && buckets[startIndex - 1].winrate >= threshold) {
        startIndex--;
    }

    // Expand right from peak while winrate stays above threshold
    // But cap at reasonable networth (don't extend window past 30k)
    let endIndex = fullPeakIndex;
    while (endIndex < buckets.length - 1 &&
           buckets[endIndex + 1].winrate >= threshold &&
           buckets[endIndex + 1].networth <= 30000) {
        endIndex++;
    }

    return {
        start: buckets[startIndex].networth,
        end: buckets[endIndex].networth,
        peakWinrate: peak.winrate,
        peakBucket: peak.networth
    };
}

/**
 * Render the timeline axis (0k to 50k markers)
 */
function renderTimelineAxis() {
    const container = document.getElementById('timeline-axis');
    if (!container) return;

    const markers = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
    container.innerHTML = markers.map(k =>
        `<span class="timeline-axis-marker">${k}k</span>`
    ).join('');
}

/**
 * Create a timeline item bar element
 */
function createTimelineItem(item, window, maxNetworth = 50000) {
    const row = document.createElement('div');
    row.className = 'timeline-item';
    row.dataset.itemId = item.item_id;

    // Calculate bar position and width as percentages
    const startPercent = (window.start / maxNetworth) * 100;
    const endPercent = ((window.end + 1000) / maxNetworth) * 100; // +1000 to give width
    const widthPercent = Math.max(endPercent - startPercent, 2); // min 2% width

    // Calculate brightness based on winrate (0.4 to 1.0)
    // 46% winrate = 0.4 brightness (dark), 54%+ = 1.0 brightness (bright)
    const wr = window.peakWinrate;
    const brightness = Math.min(1, Math.max(0.4, 0.4 + (wr - 0.46) * 7.5));

    const imageHtml = item.image
        ? `<img class="timeline-item-img" src="${item.image}" alt="${escapeHtml(item.name)}">`
        : '';

    row.innerHTML = `
        <div class="timeline-item-info">
            ${imageHtml}
            <span class="timeline-item-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        </div>
        <div class="timeline-item-bar-container">
            <div class="timeline-item-bar tier-${item.tier}"
                 style="left: ${startPercent}%; width: ${widthPercent}%; filter: brightness(${brightness.toFixed(2)});"
                 title="${escapeHtml(item.name)}: ${formatPercent(window.peakWinrate)} at ${formatSouls(window.peakBucket)}">
                ${formatPercent(window.peakWinrate)}
            </div>
        </div>
    `;

    return row;
}

/**
 * Render the purchase timeline with all items
 */
function renderTimeline(allItems) {
    const container = document.getElementById('timeline-items');
    const section = document.getElementById('timeline-section');
    if (!container || !section) return;

    // Render axis
    renderTimelineAxis();

    // Calculate windows for all items
    const itemsWithWindows = allItems
        .map(item => {
            const window = findPurchaseWindow(item);
            return window ? { item, window } : null;
        })
        .filter(x => x !== null)
        // Only show items with good sample size
        .filter(x => getBestBucketMatches(x.item) >= 1000)
        // Sort by window start (earliest purchases first)
        .sort((a, b) => a.window.start - b.window.start);

    if (itemsWithWindows.length === 0) {
        container.innerHTML = '<div class="timeline-empty">No items with sufficient data</div>';
        section.classList.remove('hidden');
        return;
    }

    // Render items
    container.innerHTML = '';
    itemsWithWindows.forEach(({ item, window }) => {
        container.appendChild(createTimelineItem(item, window));
    });

    section.classList.remove('hidden');

    return itemsWithWindows;
}

/**
 * Get recommended items for auto-fill (top items from timeline)
 */
function getRecommendedBuild(allItems) {
    const itemsWithWindows = allItems
        .map(item => {
            const window = findPurchaseWindow(item);
            return window ? { item, window } : null;
        })
        .filter(x => x !== null)
        .filter(x => getBestBucketMatches(x.item) >= 1000)
        .sort((a, b) => a.window.start - b.window.start);

    // Take top 12 items spread across the networth range
    return itemsWithWindows.slice(0, 12).map(x => x.item);
}

/**
 * Render items into a game time phase column
 * Shows items with data in this game phase
 * @param {string} phaseKey - e.g., "0-5", "5-10", "10-20", "20-30", "30+"
 * @param {Array} allItems - All items across all tiers
 * @param {string} sortBy - Sort method: 'winrate', 'popularity', or 'buy_order'
 */
function renderGameTimePhaseItems(phaseKey, allItems, sortBy = 'winrate') {
    // Handle the special case of 30+ which has different ID format
    const containerId = phaseKey === '30+' ? 'phase-30-plus-items' : `phase-${phaseKey}-items`;
    const container = document.getElementById(containerId);
    if (!container) {
        console.warn(`Container not found: ${containerId}`);
        return;
    }

    // Filter and calculate phase stats for each item
    const itemsInPhase = allItems
        .map(item => {
            // Skip items without game time data
            if (!item.winrates_by_game_time || Object.keys(item.winrates_by_game_time).length === 0) {
                return null;
            }

            // Aggregate into phases
            const phases = groupByGamePhase(item.winrates_by_game_time);
            const phaseData = phases[phaseKey];

            // Skip if no data in this phase
            if (!phaseData || phaseData.matches < 100) {
                return null;
            }

            return { item, phaseData };
        })
        .filter(x => x !== null);

    // Sort based on sortBy parameter
    switch (sortBy) {
        case 'popularity':
            itemsInPhase.sort((a, b) => b.phaseData.matches - a.phaseData.matches);
            break;
        case 'buy_order':
            itemsInPhase.sort((a, b) => a.item.avg_buy_time_s - b.item.avg_buy_time_s);
            break;
        case 'winrate':
        default:
            itemsInPhase.sort((a, b) => b.phaseData.winrate - a.phaseData.winrate);
            break;
    }

    // Always use condensed icon layout for phase view
    container.classList.add('condensed');

    container.innerHTML = '';
    if (itemsInPhase.length === 0) {
        container.innerHTML = '<div class="phase-empty">No data</div>';
        return;
    }

    itemsInPhase.forEach(({ item, phaseData }) => {
        const card = createGameTimeIconCard(item, phaseData);
        container.appendChild(card);
    });
}

/**
 * Create a compact icon card for game time phase view with winrate tooltip
 * @param {Object} item - The item data
 * @param {Object} phaseData - { winrate, matches, wins } for this phase
 * @returns {HTMLElement}
 */
function createGameTimeIconCard(item, phaseData) {
    const card = document.createElement('div');
    card.className = 'icon-card';
    card.dataset.itemId = item.item_id;

    // Add winrate-based color class (6-tier, all visible)
    // Wide thresholds to show color variety in real data
    const wr = phaseData.winrate;
    if (wr >= 0.56) {
        card.classList.add('wr-excellent');  // bright green + glow (56%+)
    } else if (wr >= 0.52) {
        card.classList.add('wr-good');       // green (52-56%)
    } else if (wr >= 0.48) {
        card.classList.add('wr-average');    // yellow-green (48-52%)
    } else if (wr >= 0.44) {
        card.classList.add('wr-below');      // yellow (44-48%)
    } else if (wr >= 0.40) {
        card.classList.add('wr-poor');       // orange (40-44%)
    } else {
        card.classList.add('wr-bad');        // red + glow (<40%)
    }

    const tooltipText = `${item.name} - ${formatPercent(phaseData.winrate)} (${formatNumber(phaseData.matches)} matches)`;

    if (item.image) {
        card.innerHTML = `<img src="${item.image}" alt="${escapeHtml(item.name)}" title="${escapeHtml(tooltipText)}">`;
    } else {
        card.textContent = item.name.substring(0, 2);
        card.title = tooltipText;
    }

    return card;
}

/**
 * Render all game time phase columns
 * @param {Array} allItems - All items across all tiers
 * @param {string} sortBy - Sort method: 'winrate', 'popularity', or 'buy_order'
 */
function renderAllPhases(allItems, sortBy = 'winrate') {
    const phases = ['0-5', '5-10', '10-20', '20-30', '30+'];
    phases.forEach(phase => renderGameTimePhaseItems(phase, allItems, sortBy));
}

// ============ Build Path Components ============

/**
 * Create an upgrade chain card showing the progression T1 → T2 → T3 → T4
 * @param {Object} chain - Chain data from the API
 * @param {Map} itemImages - Map of item_id -> image URL
 * @returns {HTMLElement}
 */
function createUpgradeChainCard(chain, itemImages) {
    const card = document.createElement('div');
    card.className = 'upgrade-chain-card';
    card.dataset.slot = chain.slot;

    // Determine winrate class
    let winrateClass = 'neutral';
    if (chain.win_rate > 0.52) winrateClass = 'positive';
    else if (chain.win_rate < 0.48) winrateClass = 'negative';

    // Create item icons for the chain
    const itemsHtml = chain.items.map((item, index) => {
        const imageUrl = item.image || itemImages.get(item.item_id) || '';
        const arrow = index < chain.items.length - 1 ? '<span class="chain-arrow">→</span>' : '';
        return `
            <div class="chain-item" data-item-id="${item.item_id}" title="${escapeHtml(item.name)} (T${item.tier} - ${item.cost} souls)">
                ${imageUrl ? `<img src="${imageUrl}" alt="${escapeHtml(item.name)}">` : `<span class="chain-item-text">${escapeHtml(item.name.substring(0, 3))}</span>`}
            </div>
            ${arrow}
        `;
    }).join('');

    // Slot badge color
    const slotColors = {
        'weapon': 'slot-weapon',
        'vitality': 'slot-vitality',
        'spirit': 'slot-spirit',
    };
    const slotClass = slotColors[chain.slot] || '';

    card.innerHTML = `
        <div class="chain-header">
            <span class="chain-slot ${slotClass}">${chain.slot}</span>
            <span class="chain-winrate ${winrateClass}">${formatPercent(chain.win_rate)}</span>
        </div>
        <div class="chain-items">
            ${itemsHtml}
        </div>
        <div class="chain-footer">
            <span class="chain-cost">${formatNumber(chain.total_cost)} souls</span>
            <span class="chain-matches">${formatNumber(chain.matches)} matches</span>
        </div>
    `;

    return card;
}

/**
 * Create a standalone item card for items without upgrade paths
 * @param {Object} item - Standalone item data from the API
 * @param {Map} itemImages - Map of item_id -> image URL
 * @returns {HTMLElement}
 */
function createStandaloneItemCard(item, itemImages) {
    const card = document.createElement('div');
    card.className = 'standalone-item-card';
    card.dataset.itemId = item.item_id;

    // Determine winrate class
    let winrateClass = 'neutral';
    if (item.win_rate > 0.52) winrateClass = 'positive';
    else if (item.win_rate < 0.48) winrateClass = 'negative';

    const imageUrl = item.image || itemImages.get(item.item_id) || '';

    // Slot badge color
    const slotColors = {
        'weapon': 'slot-weapon',
        'vitality': 'slot-vitality',
        'spirit': 'slot-spirit',
    };
    const slotClass = slotColors[item.slot] || '';

    card.innerHTML = `
        <div class="standalone-item-image">
            ${imageUrl ? `<img src="${imageUrl}" alt="${escapeHtml(item.name)}">` : `<span>${escapeHtml(item.name.substring(0, 3))}</span>`}
        </div>
        <div class="standalone-item-info">
            <span class="standalone-item-name">${escapeHtml(item.name)}</span>
            <span class="standalone-item-slot ${slotClass}">${item.slot}</span>
        </div>
        <div class="standalone-item-stats">
            <span class="standalone-item-winrate ${winrateClass}">${formatPercent(item.win_rate)}</span>
            <span class="standalone-item-matches">${formatNumber(item.matches)}</span>
        </div>
    `;

    return card;
}

/**
 * Create a phase item card for the build path view
 * Shows tier badge, win rate, and match count
 * @param {Object} item - Item data with phase_win_rate
 * @returns {HTMLElement}
 */
function createPhaseItemCard(item) {
    const card = document.createElement('div');
    card.className = 'phase-item-card';
    card.dataset.itemId = item.item_id;

    const winRate = item.powerspike_win_rate || item.phase_win_rate || item.overall_win_rate || 0;
    let winrateClass = 'neutral';
    if (winRate > 0.52) winrateClass = 'positive';
    else if (winRate < 0.48) winrateClass = 'negative';

    const imageUrl = item.image || '';

    // Slot color class
    const slotColors = { weapon: 'slot-weapon', vitality: 'slot-vitality', spirit: 'slot-spirit' };
    const slotClass = slotColors[item.slot] || '';

    const matches = item.powerspike_matches || item.phase_matches || item.overall_matches || 0;

    card.innerHTML = `
        <div class="phase-item-image">
            ${imageUrl ? `<img src="${imageUrl}" alt="${escapeHtml(item.name)}">` : `<span>${escapeHtml(item.name.substring(0, 3))}</span>`}
        </div>
        <div class="phase-item-info">
            <span class="phase-item-name">${escapeHtml(item.name)}</span>
            <span class="phase-item-meta">
                <span class="phase-item-tier tier-${item.tier}">T${item.tier}</span>
                <span class="phase-item-slot ${slotClass}">${item.slot}</span>
            </span>
        </div>
        <div class="phase-item-stats">
            <span class="phase-item-winrate ${winrateClass}">${formatPercent(winRate)}</span>
            <span class="phase-item-matches">${formatNumber(matches)} matches</span>
        </div>
    `;

    return card;
}

/**
 * Create a Best 12 item card with powerspike info
 * @param {Object} item - Item data
 * @param {number} index - Position in the build order
 * @returns {HTMLElement}
 */
function createBest12ItemCard(item, index) {
    const card = document.createElement('div');
    card.className = 'best-12-item';
    card.dataset.itemId = item.item_id;

    let winrateClass = 'neutral';
    if (item.win_rate > 0.52) winrateClass = 'positive';
    else if (item.win_rate < 0.48) winrateClass = 'negative';

    const imageUrl = item.image || '';

    // Slot color class
    const slotColors = { weapon: 'slot-weapon', vitality: 'slot-vitality', spirit: 'slot-spirit' };
    const slotClass = slotColors[item.slot] || '';

    // Powerspike badge
    let powerspikeHtml = '';
    if (item.powerspike) {
        const psClass = item.powerspike.win_rate > 0.52 ? 'positive' : 'neutral';
        powerspikeHtml = `<span class="powerspike-badge ${psClass}">${item.powerspike.phase}m: ${formatPercent(item.powerspike.win_rate)}</span>`;
    }

    card.innerHTML = `
        <span class="best-12-order">${index + 1}</span>
        <div class="best-12-item-image">
            ${imageUrl ? `<img src="${imageUrl}" alt="${escapeHtml(item.name)}">` : `<span>${escapeHtml(item.name.substring(0, 3))}</span>`}
        </div>
        <div class="best-12-item-info">
            <span class="best-12-item-name">${escapeHtml(item.name)}</span>
            <span class="best-12-item-meta">
                <span class="best-12-item-tier tier-${item.tier}">T${item.tier}</span>
                <span class="best-12-item-slot ${slotClass}">${item.slot}</span>
                <span class="best-12-item-cost">${item.cost}</span>
            </span>
        </div>
        <div class="best-12-item-stats">
            <span class="best-12-item-winrate ${winrateClass}">${formatPercent(item.win_rate)}</span>
            ${powerspikeHtml}
        </div>
    `;

    return card;
}

/**
 * Render the build path view with soul-based brackets and upgrade chains
 * @param {Object} buildPathData - Response from the build path API
 * @param {Map} itemImages - Map of item_id -> image URL
 */
function renderBuildPath(buildPathData, itemImages) {
    const container_0_5k = document.getElementById('phase-0-5k-items');
    const container_5_10k = document.getElementById('phase-5-10k-items');
    const container_10_20k = document.getElementById('phase-10-20k-items');
    const container_20k = document.getElementById('phase-20k-items');
    const chainsContainer = document.getElementById('upgrade-chains');

    // Render soul bracket-based items
    const phases = buildPathData.build_phases || {};

    // 0-5k Souls
    if (container_0_5k) {
        container_0_5k.innerHTML = '';
        const items = phases['0-5k']?.items || [];
        if (items.length > 0) {
            items.forEach(item => {
                container_0_5k.appendChild(createPhaseItemCard(item));
            });
        } else {
            container_0_5k.innerHTML = '<p class="no-data">No items</p>';
        }
    }

    // 5-10k Souls
    if (container_5_10k) {
        container_5_10k.innerHTML = '';
        const items = phases['5-10k']?.items || [];
        if (items.length > 0) {
            items.forEach(item => {
                container_5_10k.appendChild(createPhaseItemCard(item));
            });
        } else {
            container_5_10k.innerHTML = '<p class="no-data">No items</p>';
        }
    }

    // 10-20k Souls
    if (container_10_20k) {
        container_10_20k.innerHTML = '';
        const items = phases['10-20k']?.items || [];
        if (items.length > 0) {
            items.forEach(item => {
                container_10_20k.appendChild(createPhaseItemCard(item));
            });
        } else {
            container_10_20k.innerHTML = '<p class="no-data">No items</p>';
        }
    }

    // 20k+ Souls
    if (container_20k) {
        container_20k.innerHTML = '';
        const items = phases['20k+']?.items || [];
        if (items.length > 0) {
            items.forEach(item => {
                container_20k.appendChild(createPhaseItemCard(item));
            });
        } else {
            container_20k.innerHTML = '<p class="no-data">No items</p>';
        }
    }

    // Render upgrade chains (in collapsed section)
    if (chainsContainer) {
        chainsContainer.innerHTML = '';
        if (buildPathData.recommended_chains && buildPathData.recommended_chains.length > 0) {
            buildPathData.recommended_chains.forEach(chain => {
                chainsContainer.appendChild(createUpgradeChainCard(chain, itemImages));
            });
        } else {
            chainsContainer.innerHTML = '<p class="no-data">No upgrade chains available</p>';
        }
    }
}

/**
 * Get all items from build path data as flat array for adding to build
 * @param {Object} buildPathData - Response from build path API
 * @returns {Array} Array of items with basic info
 */
function getBuildPathItems(buildPathData) {
    const items = [];
    const seenIds = new Set();

    // Get items from phase-based build
    if (buildPathData.build_phases) {
        const phases = ['early_game', 'mid_game', 'late_game'];
        phases.forEach(phase => {
            const phaseData = buildPathData.build_phases[phase];
            if (phaseData && phaseData.items) {
                phaseData.items.forEach(item => {
                    if (!seenIds.has(item.item_id)) {
                        seenIds.add(item.item_id);
                        items.push({
                            item_id: item.item_id,
                            name: item.name,
                            tier: item.tier,
                            cost: item.cost,
                            slot: item.slot,
                            image: item.image,
                        });
                    }
                });
            }
        });
    }

    // Get items from chains
    if (buildPathData.recommended_chains) {
        buildPathData.recommended_chains.forEach(chain => {
            chain.items.forEach(item => {
                if (!seenIds.has(item.item_id)) {
                    seenIds.add(item.item_id);
                    items.push({
                        item_id: item.item_id,
                        name: item.name,
                        tier: item.tier,
                        cost: item.cost,
                    });
                }
            });
        });
    }

    // Get standalone items
    if (buildPathData.standalone_items) {
        buildPathData.standalone_items.forEach(item => {
            if (!seenIds.has(item.item_id)) {
                seenIds.add(item.item_id);
                items.push({
                    item_id: item.item_id,
                    name: item.name,
                    tier: item.tier,
                    cost: item.cost,
                });
            }
        });
    }

    return items;
}

// ============ Ability Build Components ============

/**
 * Create an ability icon element
 * @param {Object} ability - Ability data from items API
 * @param {number} level - The level at which this ability is picked (1-indexed)
 * @returns {HTMLElement}
 */
function createAbilityIcon(ability, level) {
    const icon = document.createElement('div');
    icon.className = 'ability-icon';
    icon.dataset.abilityId = ability?.id || 0;

    if (!ability) {
        icon.classList.add('ability-unknown');
        icon.innerHTML = `<span class="ability-level">${level}</span><span>?</span>`;
        return icon;
    }

    // Determine ability type for coloring based on class_name
    const className = ability.class_name || '';
    if (className.includes('signature4') || className.includes('ultimate')) {
        icon.classList.add('ability-ultimate');
    } else if (className.includes('signature1') || className.includes('ability_1')) {
        icon.classList.add('ability-1');
    } else if (className.includes('signature2') || className.includes('ability_2')) {
        icon.classList.add('ability-2');
    } else if (className.includes('signature3') || className.includes('ability_3')) {
        icon.classList.add('ability-3');
    }

    const imageUrl = ability.image || '';
    icon.innerHTML = `
        <span class="ability-level">${level}</span>
        ${imageUrl ? `<img src="${imageUrl}" alt="${escapeHtml(ability.name || 'Ability')}" title="${escapeHtml(ability.name || 'Ability')}">` : `<span>${escapeHtml((ability.name || '?').substring(0, 1))}</span>`}
    `;

    return icon;
}

/**
 * Create an ability sequence card showing a complete build order
 * @param {Object} sequence - Sequence data from API {abilities: [], wins, losses, matches, ...}
 * @param {Map} abilitiesMap - Map of ability_id -> ability data
 * @param {number} rank - Ranking position (1, 2, 3, ...)
 * @returns {HTMLElement}
 */
function createAbilitySequenceCard(sequence, abilitiesMap, rank) {
    const card = document.createElement('div');
    card.className = 'ability-sequence-card';

    const winRate = sequence.matches > 0 ? sequence.wins / sequence.matches : 0;
    let winrateClass = 'neutral';
    if (winRate > 0.52) winrateClass = 'positive';
    else if (winRate < 0.48) winrateClass = 'negative';

    // Calculate KDA
    const kills = sequence.total_kills || 0;
    const deaths = sequence.total_deaths || 0;
    const assists = sequence.total_assists || 0;
    const avgKills = sequence.matches > 0 ? (kills / sequence.matches).toFixed(1) : '0';
    const avgDeaths = sequence.matches > 0 ? (deaths / sequence.matches).toFixed(1) : '0';
    const avgAssists = sequence.matches > 0 ? (assists / sequence.matches).toFixed(1) : '0';

    // Create ability sequence icons
    const abilitiesHtml = sequence.abilities.map((abilityId, index) => {
        const ability = abilitiesMap.get(abilityId);
        const iconEl = createAbilityIcon(ability, index + 1);
        return iconEl.outerHTML;
    }).join('');

    card.innerHTML = `
        <div class="sequence-header">
            <span class="sequence-rank">#${rank}</span>
            <span class="sequence-winrate ${winrateClass}">${formatPercent(winRate)}</span>
            <span class="sequence-matches">${formatNumber(sequence.matches)} matches</span>
        </div>
        <div class="sequence-abilities">
            ${abilitiesHtml}
        </div>
        <div class="sequence-footer">
            <span class="sequence-kda">${avgKills} / ${avgDeaths} / ${avgAssists} KDA</span>
        </div>
    `;

    return card;
}

/**
 * Render the abilities view with all sequences
 * @param {Array} abilityStats - Array of ability sequences from API
 * @param {Map} abilitiesMap - Map of ability_id -> ability data
 */
function renderAbilitiesView(abilityStats, abilitiesMap) {
    const container = document.getElementById('ability-sequences');
    if (!container) return;

    container.innerHTML = '';

    if (!abilityStats || abilityStats.length === 0) {
        container.innerHTML = '<p class="no-data">No ability data available for this hero.</p>';
        return;
    }

    // Sort by matches (popularity) first, then by win rate
    const sortedStats = [...abilityStats].sort((a, b) => {
        // Primary sort: matches (popularity)
        if (b.matches !== a.matches) {
            return b.matches - a.matches;
        }
        // Secondary sort: win rate
        const wrA = a.matches > 0 ? a.wins / a.matches : 0;
        const wrB = b.matches > 0 ? b.wins / b.matches : 0;
        return wrB - wrA;
    });

    // Take top 10 sequences
    const topSequences = sortedStats.slice(0, 10);

    topSequences.forEach((sequence, index) => {
        const card = createAbilitySequenceCard(sequence, abilitiesMap, index + 1);
        container.appendChild(card);
    });
}

// ============ Synergy Components ============

/**
 * Create synergy badges HTML for an item card
 * Shows top 2 items that pair well with this item
 * @param {number} itemId - The item ID to find synergies for
 * @param {Map} synergyMap - Map of itemId -> [{pairedItemId, winRate, matches}, ...]
 * @param {Map} itemImagesMap - Map of item_id -> image URL
 * @param {number} maxBadges - Maximum number of badges to show (default 2)
 * @returns {string} HTML string for synergy badges
 */
function createSynergyBadges(itemId, synergyMap, itemImagesMap, maxBadges = 2) {
    if (!synergyMap || synergyMap.size === 0) return '';

    const synergies = synergyMap.get(itemId) || [];
    // Filter to synergies with high match count and good win rate
    const topSynergies = synergies
        .filter(s => s.matches >= 500 && s.winRate >= 0.50)
        .slice(0, maxBadges);

    if (topSynergies.length === 0) return '';

    const badgesHtml = topSynergies.map(syn => {
        const imageUrl = itemImagesMap.get(syn.itemId) || '';
        return `
            <span class="synergy-badge" title="${formatPercent(syn.winRate)} together">
                ${imageUrl ? `<img src="${imageUrl}" alt="">` : '?'}
            </span>
        `;
    }).join('');

    return `
        <div class="item-synergies">
            <span class="synergy-label">Pairs with:</span>
            ${badgesHtml}
        </div>
    `;
}

/**
 * Create a synergy pair card for the synergies panel view
 * @param {Object} pair - Pair data {item_ids: [id1, id2], wins, losses, matches}
 * @param {Map} itemImagesMap - Map of item_id -> image URL
 * @param {Map} itemNamesMap - Map of item_id -> item name
 * @returns {HTMLElement}
 */
function createSynergyPairCard(pair, itemImagesMap, itemNamesMap) {
    const card = document.createElement('div');
    card.className = 'synergy-pair-card';

    const [id1, id2] = pair.item_ids || [];
    const matches = pair.matches || 0;
    const wins = pair.wins || 0;
    const winRate = matches > 0 ? wins / matches : 0;

    let winrateClass = 'neutral';
    if (winRate > 0.52) winrateClass = 'positive';
    else if (winRate < 0.48) winrateClass = 'negative';

    const img1 = itemImagesMap.get(id1) || '';
    const img2 = itemImagesMap.get(id2) || '';
    const name1 = itemNamesMap.get(id1) || 'Item';
    const name2 = itemNamesMap.get(id2) || 'Item';

    card.innerHTML = `
        <div class="synergy-items">
            <div class="synergy-item" title="${escapeHtml(name1)}">
                ${img1 ? `<img src="${img1}" alt="${escapeHtml(name1)}">` : `<span>${escapeHtml(name1.substring(0, 3))}</span>`}
            </div>
            <span class="synergy-plus">+</span>
            <div class="synergy-item" title="${escapeHtml(name2)}">
                ${img2 ? `<img src="${img2}" alt="${escapeHtml(name2)}">` : `<span>${escapeHtml(name2.substring(0, 3))}</span>`}
            </div>
        </div>
        <div class="synergy-stats">
            <span class="synergy-winrate ${winrateClass}">${formatPercent(winRate)}</span>
            <span class="synergy-matches">${formatNumber(matches)} games</span>
        </div>
    `;

    return card;
}

/**
 * Render the synergies view panel
 * @param {Array} synergyData - Raw permutation data from API
 * @param {Map} itemImagesMap - Map of item_id -> image URL
 * @param {Map} itemNamesMap - Map of item_id -> item name
 */
function renderSynergiesView(synergyData, itemImagesMap, itemNamesMap) {
    const container = document.getElementById('synergy-pairs');
    if (!container) return;

    container.innerHTML = '';

    if (!synergyData || synergyData.length === 0) {
        container.innerHTML = '<p class="no-data">No synergy data available.</p>';
        return;
    }

    // Sort by win rate, filter to pairs with sufficient matches
    const sortedPairs = synergyData
        .filter(p => p.matches >= 500)
        .sort((a, b) => {
            const wrA = a.wins / a.matches;
            const wrB = b.wins / b.matches;
            return wrB - wrA;
        })
        .slice(0, 50);  // Top 50 pairs

    if (sortedPairs.length === 0) {
        container.innerHTML = '<p class="no-data">Not enough data for synergy analysis.</p>';
        return;
    }

    sortedPairs.forEach(pair => {
        const card = createSynergyPairCard(pair, itemImagesMap, itemNamesMap);
        container.appendChild(card);
    });
}

// Export for use in app.js
const Components = {
    createItemCard,
    createIconCard,
    createModalStats,
    createBuildSlot,
    renderTierItems,
    renderBuildSlots,
    renderTimeline,
    renderAllPhases,
    getRecommendedBuild,
    groupByGamePhase,
    formatPercent,
    formatNumber,
    formatNetworth,
    formatTime,
    escapeHtml,
    // Build path components
    createUpgradeChainCard,
    createStandaloneItemCard,
    createBest12ItemCard,
    createPhaseItemCard,
    renderBuildPath,
    getBuildPathItems,
    // Ability build components
    createAbilityIcon,
    createAbilitySequenceCard,
    renderAbilitiesView,
    // Synergy components
    createSynergyBadges,
    createSynergyPairCard,
    renderSynergiesView,
};
