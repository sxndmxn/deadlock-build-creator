use std::collections::HashMap;

use axum::Json;
use axum::extract::State;
use axum::response::IntoResponse;
use axum_extra::extract::Query;
use cached::TimedCache;
use cached::proc_macro::cached;
use clickhouse::Row;
use serde::Deserialize;
use tracing::debug;
use utoipa::IntoParams;

use crate::context::AppState;
use crate::error::{APIError, APIResult};
use crate::routes::v1::build_creator::structs::{
    BuildCreatorItem, BuildCreatorResponse, NetworthWinrate,
};
use crate::utils::parse::default_last_month_timestamp;

const NETWORTH_BUCKETS: [u32; 4] = [5000, 10000, 15000, 20000];

#[allow(clippy::unnecessary_wraps)]
fn default_min_matches() -> Option<u32> {
    Some(50)
}

#[derive(Debug, Clone, Deserialize, IntoParams, Eq, PartialEq, Hash)]
pub struct BuildCreatorQuery {
    /// Hero ID to get item stats for. See more: <https://assets.deadlock-api.com/v2/heroes>
    pub hero_id: u32,
    /// Minimum number of matches for statistical significance.
    #[serde(default = "default_min_matches")]
    #[param(minimum = 1, default = 50)]
    pub min_matches: Option<u32>,
    /// Filter matches based on their start time (Unix timestamp). **Default:** 30 days ago.
    #[serde(default = "default_last_month_timestamp")]
    #[param(default = default_last_month_timestamp)]
    pub min_unix_timestamp: Option<i64>,
    /// Filter matches based on their start time (Unix timestamp).
    pub max_unix_timestamp: Option<i64>,
    /// Filter matches based on the average badge level. See more: <https://assets.deadlock-api.com/v2/ranks>
    #[param(minimum = 0, maximum = 116)]
    pub min_average_badge: Option<u8>,
    /// Filter matches based on the average badge level.
    #[param(minimum = 0, maximum = 116)]
    pub max_average_badge: Option<u8>,
}

#[derive(Debug, Clone, Row, Deserialize)]
struct ItemStatsRow {
    item_id: u32,
    networth_bucket: u32,
    wins: u64,
    losses: u64,
    matches: u64,
    avg_buy_time_s: f64,
}

fn build_query(query: &BuildCreatorQuery) -> String {
    let mut info_filters = Vec::new();

    if let Some(min_unix_timestamp) = query.min_unix_timestamp {
        info_filters.push(format!("start_time >= {min_unix_timestamp}"));
    }
    if let Some(max_unix_timestamp) = query.max_unix_timestamp {
        info_filters.push(format!("start_time <= {max_unix_timestamp}"));
    }
    if let Some(min_badge_level) = query.min_average_badge {
        if min_badge_level > 11 {
            info_filters.push(format!(
                "average_badge_team0 >= {min_badge_level} AND average_badge_team1 >= {min_badge_level}"
            ));
        }
    }
    if let Some(max_badge_level) = query.max_average_badge {
        if max_badge_level < 116 {
            info_filters.push(format!(
                "average_badge_team0 <= {max_badge_level} AND average_badge_team1 <= {max_badge_level}"
            ));
        }
    }

    let info_filters = if info_filters.is_empty() {
        String::new()
    } else {
        format!(" AND {}", info_filters.join(" AND "))
    };

    let hero_id = query.hero_id;
    let min_matches = query.min_matches.unwrap_or(50);

    format!(
        "
WITH
    t_upgrades AS (SELECT id FROM items WHERE type = 'upgrade'),
    t_matches AS (
        SELECT match_id, start_time, duration_s
        FROM match_info
        WHERE match_mode IN ('Ranked', 'Unranked'){info_filters}
    ),
    exploded_players AS (
        SELECT
            match_id,
            it.item_id AS item_id,
            won,
            it.game_time_s AS buy_time,
            coalesce(
                arrayElementOrNull(
                    stats.net_worth,
                    arrayFirstIndex(ts -> ts >= it.game_time_s, stats.time_stamp_s) - 1
                ), net_worth
            ) AS net_worth_at_buy
        FROM match_player
            ARRAY JOIN items AS it
        WHERE match_id IN (SELECT match_id FROM t_matches)
            AND it.item_id IN t_upgrades
            AND it.game_time_s > 0
            AND hero_id = {hero_id}
    )
SELECT
    item_id,
    toUInt32(floor(net_worth_at_buy / 5000) * 5000) AS networth_bucket,
    sum(won) AS wins,
    sum(not won) AS losses,
    wins + losses AS matches,
    avg(buy_time) AS avg_buy_time_s
FROM exploded_players
INNER JOIN t_matches USING (match_id)
GROUP BY item_id, networth_bucket
HAVING matches >= {min_matches}
ORDER BY item_id, networth_bucket
        "
    )
}

#[cached(
    ty = "TimedCache<String, Vec<ItemStatsRow>>",
    create = "{ TimedCache::with_lifespan(std::time::Duration::from_secs(60*60)) }",
    result = true,
    convert = "{ query_str.to_string() }",
    sync_writes = "by_key",
    key = "String"
)]
async fn run_query(
    ch_client: &clickhouse::Client,
    query_str: &str,
) -> clickhouse::error::Result<Vec<ItemStatsRow>> {
    ch_client.query(query_str).fetch_all().await
}

pub async fn build_creator_items(
    Query(mut query): Query<BuildCreatorQuery>,
    State(state): State<AppState>,
) -> APIResult<impl IntoResponse> {
    // Normalize timestamps to hour boundaries for better caching
    query.min_unix_timestamp = query.min_unix_timestamp.map(|v| v - v % 3600);
    query.max_unix_timestamp = query.max_unix_timestamp.map(|v| v + 3600 - v % 3600);

    // Fetch hero name
    let hero_name = state
        .assets_client
        .fetch_hero_name_from_id(query.hero_id)
        .await
        .map_err(|e| APIError::internal(format!("Failed to fetch hero: {e}")))?
        .ok_or_else(|| APIError::bad_request(format!("Hero {} not found", query.hero_id)))?;

    // Fetch items metadata (for names and tiers)
    let items_metadata = state
        .assets_client
        .fetch_items()
        .await
        .map_err(|e| APIError::internal(format!("Failed to fetch items: {e}")))?;

    // Create a lookup map for items
    let items_map: HashMap<u32, _> = items_metadata
        .into_iter()
        .filter(|item| item.item_type.as_deref() == Some("upgrade"))
        .map(|item| (item.id, item))
        .collect();

    // Run the query
    let query_str = build_query(&query);
    debug!(?query_str);
    let stats = run_query(&state.ch_client_ro, &query_str).await?;

    // Group stats by item_id
    let mut item_stats: HashMap<u32, Vec<ItemStatsRow>> = HashMap::new();
    for row in stats {
        item_stats.entry(row.item_id).or_default().push(row);
    }

    // Build response grouped by tier
    let mut tiers: HashMap<String, Vec<BuildCreatorItem>> = HashMap::new();

    for (item_id, stats_rows) in item_stats {
        let Some(item_meta) = items_map.get(&item_id) else {
            continue;
        };

        let tier = item_meta.tier.unwrap_or(0);
        if tier == 0 {
            continue; // Skip items without a tier
        }

        // Build winrates by networth
        let mut winrates_by_networth: HashMap<String, NetworthWinrate> = HashMap::new();
        let mut total_matches = 0u64;
        let mut total_buy_time = 0.0f64;
        let mut total_buy_time_count = 0u64;

        for row in &stats_rows {
            let bucket_key = format!("{}", row.networth_bucket);
            let winrate = if row.matches > 0 {
                row.wins as f64 / row.matches as f64
            } else {
                0.0
            };

            winrates_by_networth.insert(
                bucket_key,
                NetworthWinrate {
                    winrate,
                    matches: row.matches,
                },
            );

            total_matches += row.matches;
            total_buy_time += row.avg_buy_time_s * row.matches as f64;
            total_buy_time_count += row.matches;
        }

        let avg_buy_time_s = if total_buy_time_count > 0 {
            total_buy_time / total_buy_time_count as f64
        } else {
            0.0
        };

        let item = BuildCreatorItem {
            item_id,
            name: item_meta.name.clone(),
            slot: item_meta.slot.clone(),
            matches_total: total_matches,
            avg_buy_time_s,
            winrates_by_networth,
        };

        tiers
            .entry(tier.to_string())
            .or_default()
            .push(item);
    }

    // Sort items within each tier by average winrate descending
    for items in tiers.values_mut() {
        items.sort_by(|a, b| {
            let avg_wr_a = calculate_avg_winrate(&a.winrates_by_networth);
            let avg_wr_b = calculate_avg_winrate(&b.winrates_by_networth);
            avg_wr_b.partial_cmp(&avg_wr_a).unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    Ok(Json(BuildCreatorResponse {
        hero_id: query.hero_id,
        hero_name,
        tiers,
    }))
}

fn calculate_avg_winrate(winrates: &HashMap<String, NetworthWinrate>) -> f64 {
    if winrates.is_empty() {
        return 0.0;
    }

    let total_matches: u64 = winrates.values().map(|w| w.matches).sum();
    if total_matches == 0 {
        return 0.0;
    }

    let weighted_sum: f64 = winrates
        .values()
        .map(|w| w.winrate * w.matches as f64)
        .sum();

    weighted_sum / total_matches as f64
}
