use lazy_static::lazy_static;
use std::sync::Arc;
use tokio::runtime::{Builder, Runtime};
pub mod identity {
  tonic::include_proto!("identity");
}

lazy_static! {
  pub static ref RUNTIME: Arc<Runtime> = Arc::new(
    Builder::new_multi_thread()
      .worker_threads(1)
      .max_blocking_threads(1)
      .enable_all()
      .build()
      .unwrap()
  );
}
