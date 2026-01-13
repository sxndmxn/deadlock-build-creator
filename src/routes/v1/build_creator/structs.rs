use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use strum::Display;
use utoipa::ToSchema;

/// Sorting options for items in the build creator
#[derive(Debug, Clone, Copy, Deserialize, ToSchema, Default, Display, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub(crate) enum SortBy {
    /// Sort by weighted average win rate (descending) - default
    #[default]
    WinRate,
    /// Sort by total matches/popularity (descending)
    Popularity,
    /// Sort by average buy time (ascending - earliest purchases first)
    AvgBuyOrder,
}

/// Timing mode for bucketing win rates
#[derive(Debug, Clone, Copy, Deserialize, ToSchema, Default, Display, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub(crate) enum TimingMode {
    /// Bucket by net worth (5000, 10000, 15000, 20000) - default
    #[default]
    Networth,
    /// Bucket by game phase (0-5, 5-10, 10-20, 20-30, 30+ minutes)
    GameTime,
}

/// Winrate statistics at a specific bucket (networth or game phase)
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub(crate) struct BucketWinrate {
    pub(crate) winrate: f64,
    pub(crate) matches: u64,
}

/// Item with winrate statistics across buckets (networth or game phase)
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub(crate) struct BuildCreatorItem {
    pub(crate) item_id: u32,
    pub(crate) name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) slot: Option<String>,
    pub(crate) matches_total: u64,
    pub(crate) avg_buy_time_s: f64,
    /// Average sell time in seconds (only for items that were sold)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) avg_sell_time_s: Option<f64>,
    /// Average sell time as percentage of match duration (only for items that were sold)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) avg_sell_time_relative: Option<f64>,
    /// Percentage of times this item was sold (0.0-1.0)
    pub(crate) sell_rate: f64,
    /// Winrates keyed by bucket. Keys depend on timing_mode:
    /// - networth mode: "5000", "10000", "15000", "20000"
    /// - game_time mode: "0-5", "5-10", "10-20", "20-30", "30+"
    pub(crate) winrates_by_bucket: HashMap<String, BucketWinrate>,
}

/// Response for the build creator items endpoint
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub(crate) struct BuildCreatorResponse {
    pub hero_id: u32,
    pub hero_name: String,
    /// Items grouped by tier (1, 2, 3, 4), sorted by winrate descending
    pub tiers: HashMap<String, Vec<BuildCreatorItem>>,
}
