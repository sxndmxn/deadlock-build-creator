use std::collections::HashMap;

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct AssetsHero {
    pub(crate) id: u32,
    pub(crate) name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct AssetsRanks {
    pub(crate) tier: u32,
    pub(crate) name: String,
    pub(crate) images: HashMap<String, String>,
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct AssetsItem {
    pub(crate) id: u32,
    pub(crate) name: String,
    #[serde(default)]
    pub(crate) tier: Option<u32>,
    #[serde(default)]
    #[allow(dead_code)]
    pub(crate) cost: Option<u32>,
    #[serde(rename = "type", default)]
    pub(crate) item_type: Option<String>,
    #[serde(default)]
    pub(crate) slot: Option<String>,
}
