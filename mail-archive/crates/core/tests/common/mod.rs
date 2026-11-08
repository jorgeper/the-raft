//! Shared helpers for integration tests. No importer exists yet, so libraries
//! are built directly through the store, metadata and index APIs.
#![allow(dead_code)]

use std::path::Path;

use mail_core::index::{IndexDoc, OpenedIndex, SearchIndex};
use mail_core::library::Library;
use mail_core::meta::{ImportStatus, MetaDb};
use mail_core::model::{ImportKind, MessageRef, RawMessage};
use mail_core::parse::{dedupe_keys, parse_message};
use mail_core::paths::create_private_dir;
use mail_core::store::Store;

/// Build a library in `dir` from RFC 822 messages (e.g. `MsgBuilder::build()`)
/// as import 1, then open it through the public facade.
pub fn build_library(dir: &Path, msgs: &[Vec<u8>]) -> Library {
    create_private_dir(dir).unwrap();
    {
        let mut store = Store::open(dir).unwrap();
        let meta = MetaDb::open(&dir.join("meta.sqlite")).unwrap();
        let index = match SearchIndex::open_or_create(&dir.join("index")).unwrap() {
            OpenedIndex::Ready(i) | OpenedIndex::NeedsRebuild(i) => i,
        };
        let mut writer = index.writer().unwrap();
        meta.begin_import(1, 0, "test", ImportKind::Full).unwrap();
        meta.transaction(|| {
            for bytes in msgs {
                let raw = RawMessage {
                    bytes: bytes.clone(),
                    from_line_date: None,
                };
                let parsed = parse_message(&raw).unwrap();
                let keys = dedupe_keys(&raw, &parsed);
                let r: MessageRef = store.append(&raw.bytes)?;
                let id = meta.insert_message(&parsed, &keys, r, 1)?;
                let row = meta.message(id)?;
                writer.upsert(&IndexDoc::from_parsed(id, row.thrid, 1, &parsed, false))?;
            }
            Ok(())
        })
        .unwrap();
        store.sync().unwrap();
        meta.set_import_status(1, ImportStatus::Completed).unwrap();
        writer.commit().unwrap();
    }
    Library::open(dir).unwrap()
}
