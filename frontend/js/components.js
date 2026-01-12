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
 * @returns {HTMLElement}
 */
function createItemCard(item) {
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

    card.innerHTML = `
        <div class="item-header">
            ${imageHtml}
            <span class="item-name">${escapeHtml(item.name)}</span>
            <span class="item-winrate ${overallClass}">${formatPercent(overallWinrate)}</span>
        </div>
        <div class="item-buckets">
            ${bucketRows}
        </div>
        <div class="item-footer">
            <span class="item-avg-souls">Avg souls: ${formatSouls(avgSouls)}</span>
            <span class="item-matches ${sampleClass}">${formatNumber(totalMatches)} total</span>
        </div>
    `;

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
 * Render items into a tier column, grouped by sample size quality
 * @param {string} tierId - The tier number (1-4)
 * @param {Array} items - Array of items for this tier
 */
function renderTierItems(tierId, items) {
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

    // Sort each group by winrate descending
    const sortByWinrate = (a, b) => {
        const wrA = calculateOverallWinrate(a.winrates_by_networth);
        const wrB = calculateOverallWinrate(b.winrates_by_networth);
        return wrB - wrA;
    };

    greenItems.sort(sortByWinrate);
    yellowItems.sort(sortByWinrate);
    redItems.sort(sortByWinrate);

    container.innerHTML = '';

    // Render green items
    if (greenItems.length > 0) {
        greenItems.forEach(item => {
            container.appendChild(createItemCard(item));
        });
    }

    // Separator and yellow items
    if (yellowItems.length > 0) {
        if (greenItems.length > 0) {
            container.appendChild(createSeparator('Limited Data'));
        }
        yellowItems.forEach(item => {
            container.appendChild(createItemCard(item));
        });
    }

    // Separator and red items
    if (redItems.length > 0) {
        if (greenItems.length > 0 || yellowItems.length > 0) {
            container.appendChild(createSeparator('Low Sample Size'));
        }
        redItems.forEach(item => {
            container.appendChild(createItemCard(item));
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

// Export for use in app.js
const Components = {
    createItemCard,
    createModalStats,
    createBuildSlot,
    renderTierItems,
    renderBuildSlots,
    renderTimeline,
    getRecommendedBuild,
    formatPercent,
    formatNumber,
    formatNetworth,
    formatTime,
    escapeHtml,
};
