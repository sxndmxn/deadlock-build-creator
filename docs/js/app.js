// Main Application for Deadlock Build Creator

// Application state
const state = {
    heroes: [],
    selectedHeroId: null,
    selectedNetworth: 3000,
    itemData: null,  // { hero_id, hero_name, tiers: { "1": [...], "2": [...], ... } }
    build: Array(12).fill(null),  // 12 slots
    isLoading: false,
    viewMode: 'tier',  // 'tier' or 'phase'
    sortBy: 'winrate',  // 'winrate', 'popularity', or 'buy_order'
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
    timelineSection: document.getElementById('timeline-section'),
    timelineItems: document.getElementById('timeline-items'),
    autoFillBuild: document.getElementById('auto-fill-build'),
    viewButtons: document.querySelectorAll('.view-btn'),
    phasesContainer: document.getElementById('phases-container'),
    sortButtons: document.querySelectorAll('.sort-btn'),
};

// Initialize application
async function init() {
    try {
        // Load heroes
        state.heroes = await API.fetchHeroes();
        populateHeroSelect();

        // Set up event listeners
        setupEventListeners();

        // Hide loading initially
        hideLoading();
    } catch (error) {
        console.error('Failed to initialize:', error);
        showToast('Failed to load heroes. Please refresh the page.', 'error');
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

function toggleHeroDropdown(open) {
    const isOpen = open ?? elements.heroSelectDropdown.classList.contains('hidden');
    elements.heroSelectDropdown.classList.toggle('hidden', !isOpen);
    elements.heroSelectTrigger.classList.toggle('open', isOpen);
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
    });

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

    try {
        state.itemData = await API.fetchBuildCreatorItems(heroId);
        renderAllTiers();
        hideLoading();
    } catch (error) {
        console.error('Failed to load items:', error);
        showToast(`Failed to load items: ${error.message}`, 'error');
        hideLoading();
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
        Components.renderTierItems(tier, items, state.sortBy);

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
    if (state.viewMode === 'tier') {
        elements.tiersContainer.classList.remove('hidden');
        elements.phasesContainer.classList.add('hidden');
    } else {
        elements.tiersContainer.classList.add('hidden');
        elements.phasesContainer.classList.remove('hidden');
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
