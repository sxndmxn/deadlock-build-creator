// Main Application for Deadlock Build Creator

// Application state
const state = {
    heroes: [],
    selectedHeroId: null,
    selectedNetworth: 3000,
    itemData: null,  // { hero_id, hero_name, tiers: { "1": [...], "2": [...], ... } }
    buildPathData: null,  // { hero_id, hero_name, recommended_chains, standalone_items }
    itemImagesMap: new Map(),  // item_id -> image URL
    build: Array(12).fill(null),  // 12 slots
    isLoading: false,
    viewMode: 'build',  // 'build', 'tier', 'phase', 'abilities', or 'synergies'
    sortBy: 'winrate',  // 'winrate', 'popularity', or 'buy_order'
    abilitiesData: null,  // Ability order stats from API
    abilitiesLoaded: false,  // Track if abilities have been loaded for current hero
    // Rank filter state
    ranks: [],  // Cached from /v2/ranks
    selectedRankMin: null,  // Badge level 0-116, null = no filter
    selectedRankMax: null,  // Badge level 0-116, null = no filter
    // Synergy state
    synergyData: null,  // Raw permutation stats
    synergyMap: new Map(),  // itemId -> [{pairedItemId, winRate, matches}, ...]
    synergiesLoaded: false,  // Track if synergies loaded for current hero+rank
};

// DOM Elements
const elements = {
    heroSelectWrapper: document.getElementById('hero-select-wrapper'),
    heroSelectTrigger: document.getElementById('hero-select-trigger'),
    heroSelectDropdown: document.getElementById('hero-select-dropdown'),
    networthButtons: document.querySelectorAll('.networth-btn'),
    tiersContainer: document.getElementById('tiers-container'),
    buildSlots: document.getElementById('build-slots'),
    loading: document.getElementById('loading'),
    modal: document.getElementById('item-modal'),
    modalClose: document.getElementById('modal-close'),
    modalItemName: document.getElementById('modal-item-name'),
    modalStats: document.getElementById('modal-stats'),
    clearBuild: document.getElementById('clear-build'),
    exportBuild: document.getElementById('export-build'),
    toast: document.getElementById('toast'),
    statsPanel: document.getElementById('stats-panel'),
    totalMatches: document.getElementById('total-matches'),
    heroWinrate: document.getElementById('hero-winrate'),
    itemsTracked: document.getElementById('items-tracked'),
    heroPowerspike: document.getElementById('hero-powerspike'),
    timelineSection: document.getElementById('timeline-section'),
    timelineItems: document.getElementById('timeline-items'),
    autoFillBuild: document.getElementById('auto-fill-build'),
    viewButtons: document.querySelectorAll('.view-btn'),
    phasesContainer: document.getElementById('phases-container'),
    sortButtons: document.querySelectorAll('.sort-btn'),
    buildPathContainer: document.getElementById('build-path-container'),
    upgradeChainsContainer: document.getElementById('upgrade-chains'),
    standaloneItemsContainer: document.getElementById('standalone-items'),
    abilitiesContainer: document.getElementById('abilities-container'),
    abilitiesLoading: document.getElementById('abilities-loading'),
    abilitySequences: document.getElementById('ability-sequences'),
    // Rank filter elements
    rankFilterWrapper: document.getElementById('rank-filter-wrapper'),
    rankFilterTrigger: document.getElementById('rank-filter-trigger'),
    rankFilterDropdown: document.getElementById('rank-filter-dropdown'),
    // Synergy elements
    synergiesContainer: document.getElementById('synergies-container'),
    synergiesLoading: document.getElementById('synergies-loading'),
    synergyPairs: document.getElementById('synergy-pairs'),
};

// Initialize application
async function init() {
    try {
        // Load heroes and ranks in parallel
        const [heroes, ranks] = await Promise.all([
            API.fetchHeroes(),
            API.fetchRanks(),
        ]);
        state.heroes = heroes;
        state.ranks = ranks;

        populateHeroSelect();
        populateRankDropdown();

        // Set up event listeners
        setupEventListeners();

        // Hide loading initially
        hideLoading();
    } catch (error) {
        console.error('Failed to initialize:', error);
        showToast('Failed to load data. Please refresh the page.', 'error');
        hideLoading();
    }
}

function populateHeroSelect() {
    // Sort heroes by name, filter to playable heroes
    const sortedHeroes = [...state.heroes]
        .filter(h => h.player_selectable && !h.disabled)
        .sort((a, b) => a.name.localeCompare(b.name));

    elements.heroSelectDropdown.innerHTML = '';
    sortedHeroes.forEach(hero => {
        const option = document.createElement('div');
        option.className = 'hero-option';
        option.dataset.heroId = hero.id;

        const iconUrl = hero.images?.icon_image_small || '';
        option.innerHTML = `
            <img src="${iconUrl}" alt="${hero.name}" loading="lazy">
            <span>${hero.name}</span>
        `;
        elements.heroSelectDropdown.appendChild(option);
    });
}

function populateRankDropdown() {
    if (!elements.rankFilterDropdown) return;

    // Sort ranks by tier (ascending)
    const sortedRanks = [...state.ranks].sort((a, b) => a.tier - b.tier);

    elements.rankFilterDropdown.innerHTML = '';

    // Add "All Ranks" option
    const allOption = document.createElement('div');
    allOption.className = 'rank-option selected';
    allOption.dataset.minBadge = '';
    allOption.dataset.maxBadge = '';
    allOption.innerHTML = '<span>All Ranks</span>';
    elements.rankFilterDropdown.appendChild(allOption);

    // Add each rank tier
    sortedRanks.forEach(rank => {
        const option = document.createElement('div');
        option.className = 'rank-option';
        // Badge calculation: tier * 10 + subrank (0-5 for 6 subranks)
        // For simplicity, filter by entire tier: minBadge = tier*10, maxBadge = tier*10+9
        const minBadge = rank.tier * 10;
        const maxBadge = rank.tier * 10 + 9;
        option.dataset.minBadge = minBadge;
        option.dataset.maxBadge = maxBadge;

        const iconUrl = rank.images?.large || rank.images?.small || '';
        option.innerHTML = `
            ${iconUrl ? `<img src="${iconUrl}" alt="${rank.name}" loading="lazy">` : ''}
            <span>${rank.name}</span>
        `;
        elements.rankFilterDropdown.appendChild(option);
    });
}

function toggleHeroDropdown(open) {
    const isOpen = open ?? elements.heroSelectDropdown.classList.contains('hidden');
    elements.heroSelectDropdown.classList.toggle('hidden', !isOpen);
    elements.heroSelectTrigger.classList.toggle('open', isOpen);
}

function toggleRankDropdown(open) {
    if (!elements.rankFilterDropdown || !elements.rankFilterTrigger) return;
    const isOpen = open ?? elements.rankFilterDropdown.classList.contains('hidden');
    elements.rankFilterDropdown.classList.toggle('hidden', !isOpen);
    elements.rankFilterTrigger.classList.toggle('open', isOpen);
}

function selectRank(minBadge, maxBadge, selectedOption) {
    state.selectedRankMin = minBadge;
    state.selectedRankMax = maxBadge;

    // Update UI - remove selected from all, add to clicked option
    elements.rankFilterDropdown.querySelectorAll('.rank-option').forEach(opt => {
        opt.classList.remove('selected');
    });
    if (selectedOption) {
        selectedOption.classList.add('selected');
    }

    // Update trigger text/icon
    const triggerText = elements.rankFilterTrigger.querySelector('.rank-filter-text');
    if (triggerText) {
        if (minBadge === null && maxBadge === null) {
            triggerText.innerHTML = 'All Ranks';
        } else {
            const rank = state.ranks.find(r => r.tier * 10 === minBadge);
            if (rank) {
                const iconUrl = rank.images?.large || rank.images?.small || '';
                triggerText.innerHTML = `
                    ${iconUrl ? `<img src="${iconUrl}" alt="${rank.name}">` : ''}
                    <span>${rank.name}</span>
                `;
            }
        }
    }

    // Close dropdown
    toggleRankDropdown(false);

    // Clear synergy cache since rank changed
    API.clearSynergyCache();
    state.synergiesLoaded = false;
    state.synergyMap = new Map();

    // Re-fetch items with new rank filter if hero is selected
    if (state.selectedHeroId) {
        loadHeroItems(state.selectedHeroId);
    }
}

function selectHero(heroId) {
    const hero = state.heroes.find(h => h.id === heroId);
    if (!hero) return;

    // Update trigger to show selected hero
    const iconUrl = hero.images?.icon_image_small || '';
    elements.heroSelectTrigger.querySelector('.hero-select-text').innerHTML = `
        <img src="${iconUrl}" alt="${hero.name}">
        <span>${hero.name}</span>
    `;

    // Close dropdown and load items
    toggleHeroDropdown(false);
    loadHeroItems(heroId);
}

function setupEventListeners() {
    // Hero dropdown toggle
    elements.heroSelectTrigger.addEventListener('click', () => {
        toggleHeroDropdown();
    });

    // Hero selection from dropdown
    elements.heroSelectDropdown.addEventListener('click', (e) => {
        const option = e.target.closest('.hero-option');
        if (option) {
            const heroId = parseInt(option.dataset.heroId, 10);
            selectHero(heroId);
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!elements.heroSelectWrapper.contains(e.target)) {
            toggleHeroDropdown(false);
        }
        if (elements.rankFilterWrapper && !elements.rankFilterWrapper.contains(e.target)) {
            toggleRankDropdown(false);
        }
    });

    // Rank filter dropdown toggle
    if (elements.rankFilterTrigger) {
        elements.rankFilterTrigger.addEventListener('click', () => {
            toggleRankDropdown();
        });
    }

    // Rank selection from dropdown
    if (elements.rankFilterDropdown) {
        elements.rankFilterDropdown.addEventListener('click', (e) => {
            const option = e.target.closest('.rank-option');
            if (option) {
                const minBadge = option.dataset.minBadge === '' ? null : parseInt(option.dataset.minBadge, 10);
                const maxBadge = option.dataset.maxBadge === '' ? null : parseInt(option.dataset.maxBadge, 10);
                selectRank(minBadge, maxBadge, option);
            }
        });
    }

    // Networth filter buttons
    elements.networthButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const networth = parseInt(btn.dataset.networth, 10);
            selectNetworth(networth);
        });
    });

    // Item card clicks (delegated)
    elements.tiersContainer.addEventListener('click', (e) => {
        const card = e.target.closest('.item-card');
        if (card) {
            const itemId = parseInt(card.dataset.itemId, 10);
            handleItemClick(itemId, e.shiftKey);
        }
    });

    // Build slot clicks
    elements.buildSlots.addEventListener('click', (e) => {
        const slot = e.target.closest('.build-slot');
        if (slot) {
            const slotIndex = parseInt(slot.dataset.slot, 10);
            if (slot.classList.contains('filled')) {
                removeFromBuild(slotIndex);
            }
        }
    });

    // Modal
    elements.modalClose.addEventListener('click', hideModal);
    elements.modal.addEventListener('click', (e) => {
        if (e.target === elements.modal) {
            hideModal();
        }
    });

    // Build actions
    elements.clearBuild.addEventListener('click', clearBuild);
    elements.exportBuild.addEventListener('click', exportBuild);

    // Auto-fill build from timeline
    elements.autoFillBuild.addEventListener('click', autoFillBuild);

    // Timeline item clicks (delegated)
    elements.timelineItems.addEventListener('click', (e) => {
        const bar = e.target.closest('.timeline-item-bar');
        const row = e.target.closest('.timeline-item');
        if (bar && row) {
            const itemId = parseInt(row.dataset.itemId, 10);
            const item = findItem(itemId);
            if (item) {
                addToBuild(item);
            }
        }
    });

    // View toggle (By Tier / By Phase)
    elements.viewButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            setViewMode(view);
        });
    });

    // Sort toggle (Win Rate / Popularity / Buy Order)
    elements.sortButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const sortBy = btn.dataset.sort;
            setSortBy(sortBy);
        });
    });

    // Phase container item clicks (delegated) - handles both full cards and icon cards
    elements.phasesContainer.addEventListener('click', (e) => {
        const card = e.target.closest('.item-card');
        const iconCard = e.target.closest('.icon-card');

        if (card) {
            const itemId = parseInt(card.dataset.itemId, 10);
            handleItemClick(itemId, e.shiftKey);
        } else if (iconCard) {
            const itemId = parseInt(iconCard.dataset.itemId, 10);
            // Icon cards: click adds to build, shift+click opens modal
            if (e.shiftKey) {
                const item = findItem(itemId);
                if (item) showItemModal(item);
            } else {
                const item = findItem(itemId);
                if (item) addToBuild(item);
            }
        }
    });

    // Build path container item clicks (delegated)
    elements.buildPathContainer.addEventListener('click', (e) => {
        const chainItem = e.target.closest('.chain-item');
        const standaloneCard = e.target.closest('.standalone-item-card');
        const best12Item = e.target.closest('.best-12-item');

        if (chainItem) {
            const itemId = parseInt(chainItem.dataset.itemId, 10);
            const item = findBuildPathItem(itemId);
            if (item) addToBuild(item);
        } else if (standaloneCard) {
            const itemId = parseInt(standaloneCard.dataset.itemId, 10);
            const item = findBuildPathItem(itemId);
            if (item) addToBuild(item);
        } else if (best12Item) {
            const itemId = parseInt(best12Item.dataset.itemId, 10);
            const item = findBuildPathItem(itemId);
            if (item) addToBuild(item);
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideModal();
        }
    });
}

async function loadHeroItems(heroId) {
    showLoading();
    state.selectedHeroId = heroId;
    state.buildPathData = null;  // Reset build path data when hero changes
    state.abilitiesData = null;  // Reset abilities data when hero changes
    state.abilitiesLoaded = false;
    state.synergiesLoaded = false;  // Reset synergies when hero changes
    state.synergyMap = new Map();

    try {
        // Load items metadata first (needed for both views)
        const itemsMetadata = await API.fetchItemsMetadata();

        // Build image map from items metadata
        state.itemImagesMap.clear();
        itemsMetadata.forEach(item => {
            if (item.shop_image || item.image) {
                state.itemImagesMap.set(item.id, item.shop_image || item.image);
            }
        });

        // Load item stats and synergies in parallel (with rank filter if set)
        const [itemData, synergyData] = await Promise.all([
            API.fetchBuildCreatorItems(heroId, state.selectedRankMin, state.selectedRankMax),
            API.fetchItemSynergies(heroId, state.selectedRankMin, state.selectedRankMax).catch(() => []),
        ]);

        state.itemData = itemData;
        state.synergyData = synergyData;
        state.synergyMap = API.buildSynergyMap(synergyData);
        state.synergiesLoaded = true;

        // Build upgrade chains client-side
        state.buildPathData = API.buildUpgradeChains(itemsMetadata, state.itemData);
        console.log('Built upgrade chains:', state.buildPathData);

        // Render build path view
        Components.renderBuildPath(state.buildPathData, state.itemImagesMap);

        renderAllTiers();
        hideLoading();
    } catch (error) {
        console.error('Failed to load items:', error);
        showToast(`Failed to load items: ${error.message}`, 'error');
        hideLoading();
    }
}

async function loadSynergies(heroId) {
    // Show loading state
    if (elements.synergiesLoading) {
        elements.synergiesLoading.classList.remove('hidden');
    }
    if (elements.synergyPairs) {
        elements.synergyPairs.innerHTML = '';
    }

    try {
        // Use already loaded synergy data if available, otherwise fetch
        let synergyData = state.synergyData;
        if (!synergyData || synergyData.length === 0) {
            synergyData = await API.fetchItemSynergies(
                heroId,
                state.selectedRankMin,
                state.selectedRankMax
            );
            state.synergyData = synergyData;
            state.synergyMap = API.buildSynergyMap(synergyData);
        }

        state.synergiesLoaded = true;

        // Build item names map for display
        const itemNamesMap = new Map();
        const itemsMetadata = await API.fetchItemsMetadata();
        itemsMetadata.forEach(item => {
            itemNamesMap.set(item.id, item.name);
        });

        // Render synergies view
        Components.renderSynergiesView(synergyData, state.itemImagesMap, itemNamesMap);

        if (elements.synergiesLoading) {
            elements.synergiesLoading.classList.add('hidden');
        }
    } catch (error) {
        console.error('Failed to load synergies:', error);
        if (elements.synergiesLoading) {
            elements.synergiesLoading.classList.add('hidden');
        }
        if (elements.synergyPairs) {
            elements.synergyPairs.innerHTML = '<p class="no-data">Failed to load synergy data.</p>';
        }
        showToast(`Failed to load synergies: ${error.message}`, 'error');
    }
}

async function loadAbilities(heroId) {
    if (state.abilitiesLoaded && state.selectedHeroId === heroId) {
        return; // Already loaded for this hero
    }

    // Show loading state
    elements.abilitiesLoading.classList.remove('hidden');
    elements.abilitySequences.innerHTML = '';

    try {
        // Fetch ability stats and all abilities data in parallel
        const [abilityStats, abilities] = await Promise.all([
            API.fetchAbilityStats(heroId),
            API.fetchAbilities(),
        ]);

        state.abilitiesData = abilityStats;

        // Build abilities map (id -> ability object)
        const abilitiesMap = new Map();
        abilities.forEach(ability => {
            if (ability.id) {
                abilitiesMap.set(ability.id, ability);
            }
        });

        state.abilitiesLoaded = true;

        // Render abilities view
        Components.renderAbilitiesView(abilityStats, abilitiesMap);

        elements.abilitiesLoading.classList.add('hidden');
    } catch (error) {
        console.error('Failed to load abilities:', error);
        elements.abilitiesLoading.classList.add('hidden');
        elements.abilitySequences.innerHTML = '<p class="no-data">Failed to load ability data.</p>';
        showToast(`Failed to load abilities: ${error.message}`, 'error');
    }
}

function renderAllTiers() {
    if (!state.itemData) return;

    // Collect all items and calculate stats
    let totalMatches = 0;
    let totalWins = 0;
    let itemCount = 0;

    ['1', '2', '3', '4'].forEach(tier => {
        const items = state.itemData.tiers[tier] || [];
        Components.renderTierItems(tier, items, state.sortBy, state.synergyMap, state.itemImagesMap);

        // Aggregate stats
        items.forEach(item => {
            itemCount++;
            for (const data of Object.values(item.winrates_by_networth)) {
                totalMatches += data.matches || 0;
                totalWins += data.wins || 0;
            }
        });
    });

    // Update stats panel
    const overallWinrate = totalMatches > 0 ? totalWins / totalMatches : 0;
    elements.statsPanel.classList.remove('hidden');
    elements.totalMatches.textContent = Components.formatNumber(totalMatches);
    elements.heroWinrate.textContent = Components.formatPercent(overallWinrate);
    elements.itemsTracked.textContent = itemCount;

    // Display powerspike info
    if (state.buildPathData && state.buildPathData.powerspike) {
        const ps = state.buildPathData.powerspike;
        elements.heroPowerspike.textContent = `${ps.name}min (${Components.formatPercent(ps.winRate)})`;
    } else {
        elements.heroPowerspike.textContent = '-';
    }

    // Collect all items for timeline and phase view
    const allItems = [];
    ['1', '2', '3', '4'].forEach(tier => {
        const items = state.itemData.tiers[tier] || [];
        allItems.push(...items);
    });

    // Render timeline
    Components.renderTimeline(allItems);

    // Render phase columns (always shows icons)
    Components.renderAllPhases(allItems, state.sortBy);

    // Apply current view mode
    applyViewMode();
}

function setViewMode(mode) {
    state.viewMode = mode;

    // Update button states
    elements.viewButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === mode);
    });

    applyViewMode();
}

function setSortBy(sortBy) {
    state.sortBy = sortBy;

    // Update button states
    elements.sortButtons.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.sort === sortBy);
    });

    // Re-render tiers with new sort
    renderAllTiers();
}

function applyViewMode() {
    // Hide all containers first
    elements.tiersContainer.classList.add('hidden');
    elements.phasesContainer.classList.add('hidden');
    elements.buildPathContainer.classList.add('hidden');
    elements.abilitiesContainer.classList.add('hidden');
    if (elements.synergiesContainer) {
        elements.synergiesContainer.classList.add('hidden');
    }

    // Show the active container
    if (state.viewMode === 'tier') {
        elements.tiersContainer.classList.remove('hidden');
    } else if (state.viewMode === 'phase') {
        elements.phasesContainer.classList.remove('hidden');
    } else if (state.viewMode === 'build') {
        elements.buildPathContainer.classList.remove('hidden');
    } else if (state.viewMode === 'abilities') {
        elements.abilitiesContainer.classList.remove('hidden');
        // Load abilities if not already loaded
        if (!state.abilitiesLoaded && state.selectedHeroId) {
            loadAbilities(state.selectedHeroId);
        }
    } else if (state.viewMode === 'synergies') {
        if (elements.synergiesContainer) {
            elements.synergiesContainer.classList.remove('hidden');
        }
        // Load synergies if not already loaded
        if (!state.synergiesLoaded && state.selectedHeroId) {
            loadSynergies(state.selectedHeroId);
        }
    }
}

function selectNetworth(networth) {
    state.selectedNetworth = networth;

    // Update button states
    elements.networthButtons.forEach(btn => {
        const btnNetworth = parseInt(btn.dataset.networth, 10);
        btn.classList.toggle('active', btnNetworth === networth);
    });

    // Re-render items with new sorting
    renderAllTiers();
}

function handleItemClick(itemId, isShiftClick) {
    const item = findItem(itemId);
    if (!item) return;

    if (isShiftClick) {
        // Shift+click adds to build
        addToBuild(item);
    } else {
        // Regular click shows modal
        showItemModal(item);
    }
}

function findItem(itemId) {
    if (!state.itemData) return null;

    for (const tier of Object.values(state.itemData.tiers)) {
        const item = tier.find(i => i.item_id === itemId);
        if (item) return item;
    }
    return null;
}

function findBuildPathItem(itemId) {
    if (!state.buildPathData) return null;

    // Search in best_12 items (now an array)
    if (state.buildPathData.best_12 && Array.isArray(state.buildPathData.best_12)) {
        const item = state.buildPathData.best_12.find(i => i.item_id === itemId);
        if (item) {
            return {
                item_id: item.item_id,
                name: item.name,
                tier: item.tier,
                image: item.image || state.itemImagesMap.get(item.item_id) || null,
            };
        }
    }

    // Search in chains
    if (state.buildPathData.recommended_chains) {
        for (const chain of state.buildPathData.recommended_chains) {
            const item = chain.items.find(i => i.item_id === itemId);
            if (item) {
                return {
                    item_id: item.item_id,
                    name: item.name,
                    tier: item.tier,
                    image: item.image || state.itemImagesMap.get(item.item_id) || null,
                };
            }
        }
    }

    // Search in standalone items
    if (state.buildPathData.standalone_items) {
        const item = state.buildPathData.standalone_items.find(i => i.item_id === itemId);
        if (item) {
            return {
                item_id: item.item_id,
                name: item.name,
                tier: item.tier,
                image: item.image || state.itemImagesMap.get(item.item_id) || null,
            };
        }
    }

    return null;
}

function showItemModal(item) {
    elements.modalItemName.textContent = item.name;
    elements.modalStats.innerHTML = Components.createModalStats(item);
    elements.modal.classList.add('visible');
}

function hideModal() {
    elements.modal.classList.remove('visible');
}

function addToBuild(item) {
    // Find first empty slot
    const emptyIndex = state.build.findIndex(slot => slot === null);
    if (emptyIndex === -1) {
        showToast('Build is full! Remove an item first.', 'warning');
        return;
    }

    // Check if item is already in build
    if (state.build.some(slot => slot && slot.item_id === item.item_id)) {
        showToast('Item already in build', 'warning');
        return;
    }

    state.build[emptyIndex] = item;
    Components.renderBuildSlots(state.build);
    showToast(`Added ${item.name} to build`, 'success');
}

function removeFromBuild(slotIndex) {
    const item = state.build[slotIndex];
    if (item) {
        state.build[slotIndex] = null;
        Components.renderBuildSlots(state.build);
        showToast(`Removed ${item.name} from build`);
    }
}

function clearBuild() {
    state.build = Array(12).fill(null);
    Components.renderBuildSlots(state.build);
    showToast('Build cleared');
}

function autoFillBuild() {
    if (!state.itemData) {
        showToast('Select a hero first', 'warning');
        return;
    }

    // Get all items
    const allItems = [];
    ['1', '2', '3', '4'].forEach(tier => {
        const items = state.itemData.tiers[tier] || [];
        allItems.push(...items);
    });

    // Get recommended build
    const recommended = Components.getRecommendedBuild(allItems);

    if (recommended.length === 0) {
        showToast('No items with sufficient data', 'warning');
        return;
    }

    // Clear and fill build
    state.build = Array(12).fill(null);
    recommended.forEach((item, i) => {
        if (i < 12) {
            state.build[i] = item;
        }
    });

    Components.renderBuildSlots(state.build);
    showToast(`Auto-filled ${recommended.length} items`, 'success');
}

function exportBuild() {
    const items = state.build.filter(item => item !== null);

    if (items.length === 0) {
        showToast('Build is empty!', 'warning');
        return;
    }

    const heroName = state.itemData?.hero_name || 'Unknown';
    const itemNames = items.map(i => i.name).join(', ');

    const exportText = `${heroName} Build:\n${itemNames}`;

    navigator.clipboard.writeText(exportText).then(() => {
        showToast('Build copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Failed to copy to clipboard', 'error');
    });
}

function clearItems() {
    state.itemData = null;
    state.selectedHeroId = null;
    ['1', '2', '3', '4'].forEach(tier => {
        const container = document.getElementById(`tier-${tier}-items`);
        if (container) container.innerHTML = '';
    });
    // Clear game time phase columns
    const phases = ['0-5', '5-10', '10-20', '20-30'];
    phases.forEach(phase => {
        const container = document.getElementById(`phase-${phase}-items`);
        if (container) container.innerHTML = '';
    });
    // Clear 30+ phase (special ID)
    const phase30Plus = document.getElementById('phase-30-plus-items');
    if (phase30Plus) phase30Plus.innerHTML = '';

    elements.statsPanel.classList.add('hidden');
    elements.timelineSection.classList.add('hidden');
    elements.phasesContainer.classList.add('hidden');
}

function showLoading() {
    state.isLoading = true;
    elements.loading.classList.remove('hidden');
}

function hideLoading() {
    state.isLoading = false;
    elements.loading.classList.add('hidden');
}

let toastTimeout;
function showToast(message, type = 'info') {
    elements.toast.textContent = message;
    elements.toast.className = `toast visible ${type}`;

    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
        elements.toast.classList.remove('visible');
    }, 3000);
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', init);
