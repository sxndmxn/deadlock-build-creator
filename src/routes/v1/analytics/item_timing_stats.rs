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

fn phase_id_to_name(phase_id: u8) -> &'static str {
    match phase_id {
        0 => "early_game",
        1 => "mid_game",
        2 => "late_game",
        3 => "very_late",
        _ => "unknown",
    }
}

#[derive(Debug, Clone, Deserialize, IntoParams, Eq, PartialEq, Hash, Default)]
pub(crate) struct ItemTimingQuery {
    /// Filter by hero ID
    hero_id: Option<u32>,
    /// Filter by specific item ID
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
pub struct GamePhaseStats {
    pub phase_name: String,
    pub phase_id: u8,
    pub purchase_count: u64,
    pub win_count: u64,
    pub loss_count: u64,
    pub win_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct SellTimingStats {
    pub phase_name: String,
    pub phase_id: u8,
    pub sell_count: u64,
    pub avg_hold_duration_seconds: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ItemTimingStats {
    pub item_id: u32,
    pub hero_id: Option<u32>,
    pub total_purchases: u64,
    pub total_wins: u64,
    pub total_losses: u64,
    pub overall_win_rate: f64,
    pub purchase_timing: Vec<GamePhaseStats>,
    pub sell_timing: Vec<SellTimingStats>,
    pub optimal_purchase_window: String,
    pub optimal_win_rate: f64,
}

// Intermediate structure for raw query results
#[derive(Debug, Clone, Serialize, Deserialize, clickhouse::Row)]
struct RawPhaseStats {
    item_id: u32,
    hero_id: Option<u32>,
    buy_phase: u8,
    wins: u64,
    losses: u64,
    matches: u64,
    sell_count: u64,
    avg_hold_duration_s: f64,
}

fn build_query(query: &ItemTimingQuery) -> String {
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
        player_filters.push(format!("it.item_id = {item_id}"));
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
    exploded_players AS (
        SELECT
            match_id,
            hero_id,
            it.item_id AS item_id,
            won,
            it.game_time_s AS buy_time,
            it.sold_time_s AS sold_time,
            multiIf(it.game_time_s < 300, 0, it.game_time_s < 1200, 1, it.game_time_s < 1800, 2, 3) AS buy_phase,
            multiIf(it.sold_time_s < 300, 0, it.sold_time_s < 1200, 1, it.sold_time_s < 1800, 2, 3) AS sell_phase
        FROM match_player
            ARRAY JOIN items AS it
        WHERE match_id IN (SELECT match_id FROM t_matches)
            AND it.item_id IN t_upgrades
            AND it.game_time_s > 0
            {player_filters}
    )
SELECT
    item_id,
    hero_id,
    buy_phase,
    sum(won) AS wins,
    sum(not won) AS losses,
    wins + losses AS matches,
    countIf(sold_time > 0) AS sell_count,
    avgIf(sold_time - buy_time, sold_time > 0) AS avg_hold_duration_s
FROM exploded_players
INNER JOIN t_matches USING (match_id)
GROUP BY item_id, hero_id, buy_phase
HAVING matches >= {min_matches}
ORDER BY item_id, hero_id, buy_phase
        "
    )
}

fn process_raw_results(raw_results: Vec<RawPhaseStats>) -> Vec<ItemTimingStats> {
    // Group by item_id and hero_id
    let grouped = raw_results
        .into_iter()
        .into_group_map_by(|r| (r.item_id, r.hero_id));

    let mut results = Vec::new();

    for ((item_id, hero_id), rows) in grouped {
        let mut purchase_timing = Vec::new();
        let mut sell_timing = Vec::new();
        let mut total_wins = 0u64;
        let mut total_losses = 0u64;
        let mut total_purchases = 0u64;
        let mut optimal_window = "early_game";
        let mut optimal_win_rate = 0.0;

        for r in &rows {
            let win_rate = if r.matches > 0 {
                (r.wins as f64) / (r.matches as f64)
            } else {
                0.0
            };

            purchase_timing.push(GamePhaseStats {
                phase_name: phase_id_to_name(r.buy_phase).to_string(),
                phase_id: r.buy_phase,
                purchase_count: r.matches,
                win_count: r.wins,
                loss_count: r.losses,
                win_rate,
            });

            if r.sell_count > 0 {
                sell_timing.push(SellTimingStats {
                    phase_name: phase_id_to_name(r.buy_phase).to_string(),
                    phase_id: r.buy_phase,
                    sell_count: r.sell_count,
                    avg_hold_duration_seconds: r.avg_hold_duration_s,
                });
            }

            total_wins += r.wins;
            total_losses += r.losses;
            total_purchases += r.matches;

            if win_rate > optimal_win_rate {
                optimal_win_rate = win_rate;
                optimal_window = phase_id_to_name(r.buy_phase);
            }
        }

        let overall_win_rate = if total_purchases > 0 {
            (total_wins as f64) / (total_purchases as f64)
        } else {
            0.0
        };

        results.push(ItemTimingStats {
            item_id,
            hero_id,
            total_purchases,
            total_wins,
            total_losses,
            overall_win_rate,
            purchase_timing,
            sell_timing,
            optimal_purchase_window: optimal_window.to_string(),
            optimal_win_rate,
        });
    }

    results
}

#[cached(
    ty = "TimedCache<String, Vec<ItemTimingStats>>",
    create = "{ TimedCache::with_lifespan(std::time::Duration::from_secs(60*60)) }",
    result = true,
    convert = "{ query_str.to_string() }",
    sync_writes = "by_key",
    key = "String"
)]
async fn run_query(
    ch_client: &clickhouse::Client,
    query_str: &str,
) -> clickhouse::error::Result<Vec<ItemTimingStats>> {
    let raw_results: Vec<RawPhaseStats> = ch_client
        .query(query_str)
        .fetch_all()
        .await?;
    
    Ok(process_raw_results(raw_results))
}

async fn get_item_timing_stats(
    ch_client: &clickhouse::Client,
    mut query: ItemTimingQuery,
) -> APIResult<Vec<ItemTimingStats>> {
    query.min_unix_timestamp = query.min_unix_timestamp.map(|v| v - v % 3600);
    query.max_unix_timestamp = query.max_unix_timestamp.map(|v| v + 3600 - v % 3600);
    let query_str = build_query(&query);
    debug!(?query_str);
    Ok(run_query(ch_client, &query_str).await?)
}

#[utoipa::path(
    get,
    path = "/item-timing-stats",
    params(ItemTimingQuery),
    responses(
        (status = OK, description = "Item Timing Stats", body = [ItemTimingStats]),
        (status = BAD_REQUEST, description = "Provided parameters are invalid."),
        (status = INTERNAL_SERVER_ERROR, description = "Failed to fetch item timing stats")
    ),
    tags = ["Analytics"],
    summary = "Item Timing Stats",
    description = "
Retrieves item purchase timing analytics bucketed by game phase (early/mid/late/very late).

Provides purchase counts, win rates, and sell timing per game phase, along with the optimal purchase window.

Results are cached for **1 hour** based on the unique combination of query parameters provided. Subsequent identical requests within this timeframe will receive the cached response.

### Rate Limits:
| Type | Limit |
| ---- | ----- |
| IP | 100req/s |
| Key | - |
| Global | - |
    "
)]
pub(crate) async fn item_timing_stats(
    Query(query): Query<ItemTimingQuery>,
    State(state): State<AppState>,
) -> APIResult<impl IntoResponse> {
    get_item_timing_stats(&state.ch_client_ro, query)
        .await
        .map(Json)
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn test_phase_id_to_name() {
        assert_eq!(phase_id_to_name(0), "early_game");
        assert_eq!(phase_id_to_name(1), "mid_game");
        assert_eq!(phase_id_to_name(2), "late_game");
        assert_eq!(phase_id_to_name(3), "very_late");
        assert_eq!(phase_id_to_name(99), "unknown");
    }

    #[test]
    fn test_build_query_default() {
        let query = ItemTimingQuery::default();
        let query_str = build_query(&query);
        
        assert!(query_str.contains("multiIf(it.game_time_s < 300, 0, it.game_time_s < 1200, 1, it.game_time_s < 1800, 2, 3) AS buy_phase"));
        assert!(query_str.contains("HAVING matches >= 20"));
    }

    #[test]
    fn test_build_query_with_hero_id() {
        let query = ItemTimingQuery {
            hero_id: Some(42),
            ..Default::default()
        };
        let query_str = build_query(&query);
        
        assert!(query_str.contains("hero_id = 42"));
    }

    #[test]
    fn test_build_query_with_item_id() {
        let query = ItemTimingQuery {
            item_id: Some(123),
            ..Default::default()
        };
        let query_str = build_query(&query);
        
        assert!(query_str.contains("it.item_id = 123"));
    }

    #[test]
    fn test_build_query_with_min_matches() {
        let query = ItemTimingQuery {
            min_matches: Some(50),
            ..Default::default()
        };
        let query_str = build_query(&query);
        
        assert!(query_str.contains("HAVING matches >= 50"));
    }

    #[test]
    fn test_build_query_with_timestamp_range() {
        let query = ItemTimingQuery {
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
        let query = ItemTimingQuery {
            min_average_badge: Some(61),
            max_average_badge: Some(112),
            ..Default::default()
        };
        let query_str = build_query(&query);
        
        assert!(query_str.contains("average_badge_team0 >= 61 AND average_badge_team1 >= 61"));
        assert!(query_str.contains("average_badge_team0 <= 112 AND average_badge_team1 <= 112"));
    }
}
