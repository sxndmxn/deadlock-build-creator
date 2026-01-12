// Main Application for Deadlock Build Creator

// Application state
const state = {
    heroes: [],
    selectedHeroId: null,
    selectedNetworth: 3000,
    itemData: null,  // { hero_id, hero_name, tiers: { "1": [...], "2": [...], ... } }
    build: Array(12).fill(null),  // 12 slots
    isLoading: false,
};

// DOM Elements
const elements = {
    heroSelect: document.getElementById('hero-select'),
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
    // Sort heroes by name
    const sortedHeroes = [...state.heroes].sort((a, b) =>
        a.name.localeCompare(b.name)
    );

    elements.heroSelect.innerHTML = '<option value="">Select a hero...</option>';
    sortedHeroes.forEach(hero => {
        const option = document.createElement('option');
        option.value = hero.id;
        option.textContent = hero.name;
        elements.heroSelect.appendChild(option);
    });
}

function setupEventListeners() {
    // Hero selection
    elements.heroSelect.addEventListener('change', async (e) => {
        const heroId = parseInt(e.target.value, 10);
        if (heroId) {
            await loadHeroItems(heroId);
        } else {
            clearItems();
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
        Components.renderTierItems(tier, items);

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
    elements.statsPanel.classList.add('hidden');
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
