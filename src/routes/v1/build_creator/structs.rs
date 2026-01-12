use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Winrate statistics at a specific networth bracket
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct NetworthWinrate {
    pub winrate: f64,
    pub matches: u64,
}

/// Item with winrate statistics across networth brackets
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct BuildCreatorItem {
    pub item_id: u32,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slot: Option<String>,
    pub matches_total: u64,
    pub avg_buy_time_s: f64,
    /// Winrates keyed by networth bracket (e.g., "5000", "10000", "15000", "20000")
    pub winrates_by_networth: HashMap<String, NetworthWinrate>,
}

/// Response for the build creator items endpoint
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct BuildCreatorResponse {
    pub hero_id: u32,
    pub hero_name: String,
    /// Items grouped by tier (1, 2, 3, 4), sorted by winrate descending
    pub tiers: HashMap<String, Vec<BuildCreatorItem>>,
}
