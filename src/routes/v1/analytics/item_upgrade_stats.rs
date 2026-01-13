use axum::Json;
use axum::extract::State;
use axum::response::IntoResponse;
use axum_extra::extract::Query;
use cached::TimedCache;
use cached::proc_macro::cached;
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use tracing::debug;
use utoipa::{IntoParams, ToSchema};

use crate::context::AppState;
use crate::error::APIResult;
use crate::utils::parse::default_last_month_timestamp;

#[allow(clippy::unnecessary_wraps)]
fn default_min_matches() -> Option<u32> {
    20.into()
}

#[derive(Debug, Clone, Deserialize, IntoParams, Eq, PartialEq, Hash, Default)]
pub(crate) struct ItemUpgradeQuery {
    /// Filter by hero ID
    hero_id: Option<u32>,
    /// Filter by specific item ID (the source item to track upgrades from)
    item_id: Option<u32>,
    /// Minimum badge level filter
    #[param(minimum = 0, maximum = 116)]
    min_average_badge: Option<u8>,
    /// Maximum badge level filter
    #[param(minimum = 0, maximum = 116)]
    max_average_badge: Option<u8>,
    /// Filter matches from this timestamp
    #[serde(default = "default_last_month_timestamp")]
    min_unix_timestamp: Option<i64>,
    /// Filter matches until this timestamp
    max_unix_timestamp: Option<i64>,
    /// Minimum matches for statistical significance
    #[serde(default = "default_min_matches")]
    #[param(minimum = 1, default = 20)]
    min_matches: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct UpgradeTarget {
    pub target_item_id: u32,
    pub upgrade_count: u64,
    pub upgrade_rate: f64,
    pub avg_upgrade_time_minutes: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ItemUpgradeStats {
    pub item_id: u32,
    pub hero_id: Option<u32>,
    pub total_purchases: u64,
    pub upgrades_to: Vec<UpgradeTarget>,
    pub sell_rate: f64,
    pub hold_rate: f64,
}

// Intermediate structure for raw query results
#[derive(Debug, Clone, Serialize, Deserialize, clickhouse::Row)]
struct RawUpgradeStats {
    item_id: u32,
    hero_id: Option<u32>,
    total_purchases: u64,
    target_item: u32,
    upgrade_count: u64,
    avg_upgrade_time_minutes: f64,
    total_sold: u64,
    total_held: u64,
}

fn build_query(query: &ItemUpgradeQuery) -> String {
    /* ---------- match_info filters ---------- */
    let mut info_filters = Vec::new();
    if let Some(min_unix_timestamp) = query.min_unix_timestamp {
        info_filters.push(format!("start_time >= {min_unix_timestamp}"));
    }
    if let Some(max_unix_timestamp) = query.max_unix_timestamp {
        info_filters.push(format!("start_time <= {max_unix_timestamp}"));
    }
    if let Some(min_badge_level) = query.min_average_badge
        && min_badge_level > 11
    {
        info_filters.push(format!(
            "average_badge_team0 >= {min_badge_level} AND average_badge_team1 >= {min_badge_level}"
        ));
    }
    if let Some(max_badge_level) = query.max_average_badge
        && max_badge_level < 116
    {
        info_filters.push(format!(
            "average_badge_team0 <= {max_badge_level} AND average_badge_team1 <= {max_badge_level}"
        ));
    }
    let info_filters = if info_filters.is_empty() {
        String::new()
    } else {
        format!(" AND {}", info_filters.join(" AND "))
    };

    /* ---------- match_player filters ---------- */
    let mut player_filters = Vec::new();
    if let Some(hero_id) = query.hero_id {
        player_filters.push(format!("hero_id = {hero_id}"));
    }
    if let Some(item_id) = query.item_id {
        player_filters.push(format!("source_item = {item_id}"));
    }
    let player_filters = if player_filters.is_empty() {
        String::new()
    } else {
        format!(" AND {}", player_filters.join(" AND "))
    };

    let min_matches = query.min_matches.unwrap_or(20);

    /* ---------- final query ---------- */
    format!(
        "
WITH
    t_upgrades AS (SELECT id FROM items WHERE type = 'upgrade'),
    t_matches AS (
        SELECT match_id, start_time, duration_s
        FROM match_info
        WHERE match_mode IN ('Ranked', 'Unranked'){info_filters}
    ),
    player_items AS (
        SELECT
            match_id,
            hero_id,
            it.item_id AS item_id,
            it.game_time_s AS buy_time,
            it.sold_time_s AS sold_time,
            arraySort(x -> x.game_time_s, items) AS sorted_items
        FROM match_player
            ARRAY JOIN items AS it
        WHERE match_id IN (SELECT match_id FROM t_matches)
            AND it.item_id IN t_upgrades
            AND it.game_time_s > 0
    ),
    item_sequences AS (
        SELECT
            match_id,
            hero_id,
            item_id AS source_item,
            buy_time AS source_buy_time,
            sold_time AS source_sold_time,
            sorted_items
        FROM player_items
    ),
    upgrade_pairs AS (
        SELECT
            source_item,
            hero_id,
            arrayFilter(
                x -> x.game_time_s > source_buy_time AND x.game_time_s <= source_buy_time + 600,
                sorted_items
            ) AS potential_upgrades,
            if(source_sold_time > 0, 1, 0) AS was_sold,
            if(source_sold_time = 0, 1, 0) AS was_held
        FROM item_sequences
    ),
    upgrade_stats AS (
        SELECT
            source_item,
            hero_id,
            arrayElement(potential_upgrades, 1).item_id AS target_item,
            arrayElement(potential_upgrades, 1).game_time_s - arrayElement(potential_upgrades, 1).game_time_s AS upgrade_time_diff,
            was_sold,
            was_held
        FROM upgrade_pairs
        WHERE length(potential_upgrades) > 0
    )
SELECT
    source_item AS item_id,
    hero_id,
    count() AS total_purchases,
    target_item,
    count() AS upgrade_count,
    avg(upgrade_time_diff) / 60.0 AS avg_upgrade_time_minutes,
    sum(was_sold) AS total_sold,
    sum(was_held) AS total_held
FROM upgrade_stats
WHERE source_item IN t_upgrades{player_filters}
GROUP BY item_id, hero_id, target_item
HAVING total_purchases >= {min_matches}
ORDER BY item_id, hero_id, upgrade_count DESC
        "
    )
}

fn process_raw_results(raw_results: Vec<RawUpgradeStats>) -> Vec<ItemUpgradeStats> {
    // Group by item_id and hero_id
    let grouped = raw_results
        .into_iter()
        .into_group_map_by(|r| (r.item_id, r.hero_id));

    let mut results = Vec::new();

    for ((item_id, hero_id), rows) in grouped {
        let total_purchases = rows.first().map(|r| r.total_purchases).unwrap_or(0);
        
        let mut upgrades_to = Vec::new();
        let mut total_sold = 0u64;
        let mut total_held = 0u64;

        for r in rows {
            let upgrade_rate = if total_purchases > 0 {
                (r.upgrade_count as f64) / (total_purchases as f64)
            } else {
                0.0
            };

            upgrades_to.push(UpgradeTarget {
                target_item_id: r.target_item,
                upgrade_count: r.upgrade_count,
                upgrade_rate,
                avg_upgrade_time_minutes: r.avg_upgrade_time_minutes,
            });

            total_sold += r.total_sold;
            total_held += r.total_held;
        }

        let sell_rate = if total_purchases > 0 {
            (total_sold as f64) / (total_purchases as f64)
        } else {
            0.0
        };

        let hold_rate = if total_purchases > 0 {
            (total_held as f64) / (total_purchases as f64)
        } else {
            0.0
        };

        results.push(ItemUpgradeStats {
            item_id,
            hero_id,
            total_purchases,
            upgrades_to,
            sell_rate,
            hold_rate,
        });
    }

    results
}

#[cached(
    ty = "TimedCache<String, Vec<ItemUpgradeStats>>",
    create = "{ TimedCache::with_lifespan(std::time::Duration::from_secs(60*60)) }",
    result = true,
    convert = "{ query_str.to_string() }",
    sync_writes = "by_key",
    key = "String"
)]
async fn run_query(
    ch_client: &clickhouse::Client,
    query_str: &str,
) -> clickhouse::error::Result<Vec<ItemUpgradeStats>> {
    let raw_results: Vec<RawUpgradeStats> = ch_client
        .query(query_str)
        .fetch_all()
        .await?;
    
    Ok(process_raw_results(raw_results))
}

async fn get_item_upgrade_stats(
    ch_client: &clickhouse::Client,
    mut query: ItemUpgradeQuery,
) -> APIResult<Vec<ItemUpgradeStats>> {
    query.min_unix_timestamp = query.min_unix_timestamp.map(|v| v - v % 3600);
    query.max_unix_timestamp = query.max_unix_timestamp.map(|v| v + 3600 - v % 3600);
    let query_str = build_query(&query);
    debug!(?query_str);
    Ok(run_query(ch_client, &query_str).await?)
}

#[utoipa::path(
    get,
    path = "/item-upgrade-stats",
    params(ItemUpgradeQuery),
    responses(
        (status = OK, description = "Item Upgrade Stats", body = [ItemUpgradeStats]),
        (status = BAD_REQUEST, description = "Provided parameters are invalid."),
        (status = INTERNAL_SERVER_ERROR, description = "Failed to fetch item upgrade stats")
    ),
    tags = ["Analytics"],
    summary = "Item Upgrade Stats",
    description = "
Retrieves item upgrade path analytics based on sequential item purchases within matches.

Tracks upgrade patterns between item tiers, showing which items are commonly purchased after selling a specific item.

Results are cached for **1 hour** based on the unique combination of query parameters provided. Subsequent identical requests within this timeframe will receive the cached response.

### Rate Limits:
| Type | Limit |
| ---- | ----- |
| IP | 100req/s |
| Key | - |
| Global | - |
    "
)]
pub(crate) async fn item_upgrade_stats(
    Query(query): Query<ItemUpgradeQuery>,
    State(state): State<AppState>,
) -> APIResult<impl IntoResponse> {
    get_item_upgrade_stats(&state.ch_client_ro, query)
        .await
        .map(Json)
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_build_query_default() {
        let query = ItemUpgradeQuery::default();
        let query_str = build_query(&query);
        
        assert!(query_str.contains("HAVING total_purchases >= 20"));
        assert!(query_str.contains("potential_upgrades"));
    }

    #[test]
    fn test_build_query_with_hero_id() {
        let query = ItemUpgradeQuery {
            hero_id: Some(42),
            ..Default::default()
        };
        let query_str = build_query(&query);
        
        assert!(query_str.contains("hero_id = 42"));
    }

    #[test]
    fn test_build_query_with_item_id() {
        let query = ItemUpgradeQuery {
            item_id: Some(123),
            ..Default::default()
        };
        let query_str = build_query(&query);
        
        assert!(query_str.contains("source_item = 123"));
    }

    #[test]
    fn test_build_query_with_min_matches() {
        let query = ItemUpgradeQuery {
            min_matches: Some(50),
            ..Default::default()
        };
        let query_str = build_query(&query);
        
        assert!(query_str.contains("HAVING total_purchases >= 50"));
    }

    #[test]
    fn test_build_query_with_timestamp_range() {
        let query = ItemUpgradeQuery {
            min_unix_timestamp: Some(1672531200),
            max_unix_timestamp: Some(1675209599),
            ..Default::default()
        };
        let query_str = build_query(&query);
        
        assert!(query_str.contains("start_time >= 1672531200"));
        assert!(query_str.contains("start_time <= 1675209599"));
    }

    #[test]
    fn test_build_query_with_badge_levels() {
        let query = ItemUpgradeQuery {
            min_average_badge: Some(61),
            max_average_badge: Some(112),
            ..Default::default()
        };
        let query_str = build_query(&query);
        
        assert!(query_str.contains("average_badge_team0 >= 61 AND average_badge_team1 >= 61"));
        assert!(query_str.contains("average_badge_team0 <= 112 AND average_badge_team1 <= 112"));
    }
}
