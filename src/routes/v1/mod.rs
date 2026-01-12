use utoipa_axum::router::OpenApiRouter;

use crate::context::AppState;

pub mod analytics;
mod build_creator;
pub mod builds;
mod commands;
pub(crate) mod data_privacy;
mod esports;
pub mod info;
mod leaderboard;
pub mod matches;
mod patches;
pub mod players;
pub mod sql;

pub(super) fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::new()
        .nest("/matches", matches::router())
        .nest("/players", players::router())
        .nest("/leaderboard", leaderboard::router())
        .nest("/analytics", analytics::router())
        .nest("/builds", builds::router())
        .nest("/build-creator", build_creator::router())
        .nest("/patches", patches::router())
        .nest("/commands", commands::router())
        .nest("/info", info::router())
        .nest("/esports", esports::router())
        .nest("/sql", sql::router())
}
