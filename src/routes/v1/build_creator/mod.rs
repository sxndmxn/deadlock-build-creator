mod handlers;
pub mod structs;

use core::time::Duration;

use utoipa::OpenApi;
use utoipa_axum::router::OpenApiRouter;
use utoipa_axum::routes;

use crate::context::AppState;
use crate::middleware::cache::CacheControlMiddleware;

#[derive(OpenApi)]
#[openapi(tags((name = "Build Creator", description = "
Hero build creation tools with item statistics grouped by tier and networth.
Helps players quickly create optimal builds based on winrate data.
")))]
struct ApiDoc;

pub(super) fn router() -> OpenApiRouter<AppState> {
    OpenApiRouter::with_openapi(ApiDoc::openapi()).merge(
        OpenApiRouter::new()
            .routes(routes!(items))
            .layer(
                CacheControlMiddleware::new(Duration::from_secs(60 * 60))
                    .with_stale_while_revalidate(Duration::from_secs(12 * 60 * 60))
                    .with_stale_if_error(Duration::from_secs(24 * 60 * 60)),
            ),
    )
}

#[utoipa::path(
    get,
    path = "/items",
    params(handlers::BuildCreatorQuery),
    responses(
        (status = OK, description = "Build Creator Items", body = structs::BuildCreatorResponse),
        (status = BAD_REQUEST, description = "Provided parameters are invalid."),
        (status = INTERNAL_SERVER_ERROR, description = "Failed to fetch build creator items")
    ),
    tags = ["Build Creator"],
    summary = "Build Creator Items",
    description = "
Retrieves item statistics for a hero, grouped by tier and with winrates by networth bracket.

Each item includes:
- Name and metadata
- Total matches
- Average buy time
- Winrates at different networth brackets (5k, 10k, 15k, 20k+)

Items within each tier are sorted by weighted average winrate (descending).

Results are cached for **1 hour** based on the unique combination of query parameters provided.

### Rate Limits:
| Type | Limit |
| ---- | ----- |
| IP | 100req/s |
| Key | - |
| Global | - |
    "
)]
pub(crate) async fn items(
    query: axum_extra::extract::Query<handlers::BuildCreatorQuery>,
    state: axum::extract::State<AppState>,
) -> crate::error::APIResult<impl axum::response::IntoResponse> {
    handlers::build_creator_items(query, state).await
}
