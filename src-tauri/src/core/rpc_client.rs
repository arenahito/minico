#![allow(dead_code)]

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::Duration;

use serde_json::{json, Value};
use thiserror::Error;

use super::events::{JsonRpcErrorPayload, RpcEvent, RpcResponsePayload};
use super::jsonl_codec::{decode_json_line, encode_json_line, JsonlCodecError};

#[derive(Debug, Error)]
pub enum RpcClientError {
    #[error("Failed to write JSON-RPC message: {0}")]
    Write(std::io::Error),
    #[error("Failed to encode JSON-RPC message: {0}")]
    Encode(#[from] JsonlCodecError),
    #[error("Timed out waiting for response (id={0})")]
    Timeout(u64),
    #[error("Response channel closed unexpectedly (id={0})")]
    ChannelClosed(u64),
    #[error("Invalid JSON-RPC message: {0}")]
    InvalidMessage(String),
}

type PendingMap = Arc<Mutex<HashMap<u64, mpsc::Sender<RpcResponsePayload>>>>;

pub struct RpcClient {
    next_id: AtomicU64,
    pending: PendingMap,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    event_rx: Arc<Mutex<mpsc::Receiver<RpcEvent>>>,
}

impl RpcClient {
    pub fn new<W, R>(writer: W, reader: R) -> Self
    where
        W: Write + Send + 'static,
        R: Read + Send + 'static,
    {
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let writer = Arc::new(Mutex::new(Box::new(writer) as Box<dyn Write + Send>));
        let (event_tx, event_rx) = mpsc::channel();

        Self::spawn_reader_thread(reader, Arc::clone(&pending), event_tx);

        Self {
            next_id: AtomicU64::new(1),
            pending,
            writer,
            event_rx: Arc::new(Mutex::new(event_rx)),
        }
    }

    pub fn request(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<RpcResponsePayload, RpcClientError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let message = json!({
            "id": id,
            "method": method,
            "params": params,
        });

        let (response_tx, response_rx) = mpsc::channel();
        self.pending
            .lock()
            .expect("pending map lock")
            .insert(id, response_tx);

        if let Err(error) = self.write_message(&message) {
            self.pending.lock().expect("pending map lock").remove(&id);
            return Err(error);
        }

        match response_rx.recv_timeout(timeout) {
            Ok(payload) => Ok(payload),
            Err(mpsc::RecvTimeoutError::Timeout) => {
                self.pending.lock().expect("pending map lock").remove(&id);
                Err(RpcClientError::Timeout(id))
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(RpcClientError::ChannelClosed(id)),
        }
    }

    pub fn notify(&self, method: &str, params: Value) -> Result<(), RpcClientError> {
        let message = json!({
            "method": method,
            "params": params,
        });
        self.write_message(&message)
    }

    pub fn respond_result(&self, id: u64, result: Value) -> Result<(), RpcClientError> {
        let message = json!({
            "id": id,
            "result": result,
        });
        self.write_message(&message)
    }

    pub fn respond_error(
        &self,
        id: u64,
        code: i64,
        message: &str,
        data: Option<Value>,
    ) -> Result<(), RpcClientError> {
        let payload = json!({
            "id": id,
            "error": {
                "code": code,
                "message": message,
                "data": data,
            }
        });
        self.write_message(&payload)
    }

    pub fn recv_event_timeout(
        &self,
        timeout: Duration,
    ) -> Result<Option<RpcEvent>, RpcClientError> {
        let guard = self.event_rx.lock().expect("event receiver lock");
        match guard.recv_timeout(timeout) {
            Ok(event) => Ok(Some(event)),
            Err(mpsc::RecvTimeoutError::Timeout) => Ok(None),
            Err(mpsc::RecvTimeoutError::Disconnected) => Err(RpcClientError::InvalidMessage(
                "reader event channel disconnected".to_string(),
            )),
        }
    }

    fn write_message(&self, message: &Value) -> Result<(), RpcClientError> {
        let encoded = encode_json_line(message)?;
        let mut writer = self.writer.lock().expect("writer lock");
        writer
            .write_all(encoded.as_bytes())
            .map_err(RpcClientError::Write)?;
        writer.flush().map_err(RpcClientError::Write)?;
        Ok(())
    }

    fn spawn_reader_thread<R>(reader: R, pending: PendingMap, event_tx: mpsc::Sender<RpcEvent>)
    where
        R: Read + Send + 'static,
    {
        thread::spawn(move || {
            let buffered = BufReader::new(reader);
            for line in buffered.lines() {
                match line {
                    Ok(raw) => {
                        let decoded = match decode_json_line(&raw) {
                            Ok(value) => value,
                            Err(error) => {
                                let _ = event_tx.send(RpcEvent::MalformedLine {
                                    raw,
                                    reason: error.to_string(),
                                });
                                continue;
                            }
                        };

                        if let Err(error) = Self::dispatch_incoming(decoded, &pending, &event_tx) {
                            let _ = event_tx.send(RpcEvent::MalformedLine {
                                raw: String::new(),
                                reason: error.to_string(),
                            });
                        }
                    }
                    Err(error) => {
                        let _ = event_tx.send(RpcEvent::MalformedLine {
                            raw: String::new(),
                            reason: error.to_string(),
                        });
                        break;
                    }
                }
            }
        });
    }

    fn dispatch_incoming(
        incoming: Value,
        pending: &PendingMap,
        event_tx: &mpsc::Sender<RpcEvent>,
    ) -> Result<(), RpcClientError> {
        if let Some(method) = incoming.get("method").and_then(Value::as_str) {
            let params = incoming.get("params").cloned().unwrap_or(Value::Null);
            if let Some(id) = incoming.get("id").and_then(Value::as_u64) {
                event_tx
                    .send(RpcEvent::ServerRequest {
                        id,
                        method: method.to_string(),
                        params,
                    })
                    .map_err(|error| RpcClientError::InvalidMessage(error.to_string()))?;
                return Ok(());
            }

            event_tx
                .send(RpcEvent::Notification {
                    method: method.to_string(),
                    params,
                })
                .map_err(|error| RpcClientError::InvalidMessage(error.to_string()))?;
            return Ok(());
        }

        if let Some(id) = incoming.get("id").and_then(Value::as_u64) {
            let payload = if let Some(result) = incoming.get("result") {
                RpcResponsePayload::Result(result.clone())
            } else if let Some(error) = incoming.get("error") {
                let code = error.get("code").and_then(Value::as_i64).ok_or_else(|| {
                    RpcClientError::InvalidMessage("error.code missing".to_string())
                })?;
                let message = error
                    .get("message")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        RpcClientError::InvalidMessage("error.message missing".to_string())
                    })?;
                let data = error.get("data").cloned();
                RpcResponsePayload::Error(JsonRpcErrorPayload {
                    code,
                    message: message.to_string(),
                    data,
                })
            } else {
                return Err(RpcClientError::InvalidMessage(
                    "response requires result or error".to_string(),
                ));
            };

            if let Some(waiter) = pending.lock().expect("pending map lock").remove(&id) {
                let _ = waiter.send(payload);
            }
            return Ok(());
        }

        Err(RpcClientError::InvalidMessage(
            "message does not match request/response/notification".to_string(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::io::{self, Read, Write};
    use std::sync::{mpsc, Arc, Mutex};
    use std::thread;
    use std::time::Duration;

    use serde_json::json;

    use super::super::events::{JsonRpcErrorPayload, RpcEvent, RpcResponsePayload};
    use super::RpcClient;

    struct ChannelWriter {
        tx: mpsc::Sender<Vec<u8>>,
    }

    impl Write for ChannelWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.tx
                .send(buf.to_vec())
                .map_err(|error| io::Error::new(io::ErrorKind::BrokenPipe, error.to_string()))?;
            Ok(buf.len())
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    struct ChannelReader {
        rx: mpsc::Receiver<Vec<u8>>,
        buffer: Vec<u8>,
        cursor: usize,
    }

    impl ChannelReader {
        fn new(rx: mpsc::Receiver<Vec<u8>>) -> Self {
            Self {
                rx,
                buffer: Vec::new(),
                cursor: 0,
            }
        }
    }

    impl Read for ChannelReader {
        fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
            if self.cursor >= self.buffer.len() {
                match self.rx.recv() {
                    Ok(next_chunk) => {
                        self.buffer = next_chunk;
                        self.cursor = 0;
                    }
                    Err(_) => return Ok(0),
                }
            }

            let remaining = self.buffer.len().saturating_sub(self.cursor);
            let size = remaining.min(out.len());
            if size == 0 {
                return Ok(0);
            }
            out[..size].copy_from_slice(&self.buffer[self.cursor..self.cursor + size]);
            self.cursor += size;
            Ok(size)
        }
    }

    #[test]
    fn dispatches_notification_event() {
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (event_tx, event_rx) = mpsc::channel();
        let message = json!({"method":"turn/started","params":{"threadId":"t1"}});
        RpcClient::dispatch_incoming(message, &pending, &event_tx).expect("dispatch");

        let received = event_rx.recv().expect("event");
        assert_eq!(
            received,
            RpcEvent::Notification {
                method: "turn/started".to_string(),
                params: json!({"threadId":"t1"}),
            }
        );
    }

    #[test]
    fn dispatches_server_request_event() {
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (event_tx, event_rx) = mpsc::channel();
        let message =
            json!({"id":42,"method":"item/fileChange/requestApproval","params":{"path":"a.txt"}});
        RpcClient::dispatch_incoming(message, &pending, &event_tx).expect("dispatch");

        let received = event_rx.recv().expect("event");
        assert_eq!(
            received,
            RpcEvent::ServerRequest {
                id: 42,
                method: "item/fileChange/requestApproval".to_string(),
                params: json!({"path":"a.txt"}),
            }
        );
    }

    #[test]
    fn routes_response_to_pending_request() {
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (event_tx, _event_rx) = mpsc::channel();
        let (waiter_tx, waiter_rx) = mpsc::channel();
        pending.lock().expect("pending lock").insert(7, waiter_tx);

        let message = json!({"id":7,"result":{"ok":true}});
        RpcClient::dispatch_incoming(message, &pending, &event_tx).expect("dispatch");

        let payload = waiter_rx.recv().expect("response");
        assert_eq!(payload, RpcResponsePayload::Result(json!({"ok": true})));
        assert!(!pending.lock().expect("pending lock").contains_key(&7));
    }

    #[test]
    fn routes_error_response_to_pending_request() {
        let pending = Arc::new(Mutex::new(HashMap::new()));
        let (event_tx, _event_rx) = mpsc::channel();
        let (waiter_tx, waiter_rx) = mpsc::channel();
        pending.lock().expect("pending lock").insert(9, waiter_tx);

        let message =
            json!({"id":9,"error":{"code":-32001,"message":"overloaded","data":{"retry":true}}});
        RpcClient::dispatch_incoming(message, &pending, &event_tx).expect("dispatch");

        let payload = waiter_rx.recv().expect("response");
        assert_eq!(
            payload,
            RpcResponsePayload::Error(JsonRpcErrorPayload {
                code: -32001,
                message: "overloaded".to_string(),
                data: Some(json!({"retry": true})),
            })
        );
    }

    #[test]
    fn request_ids_remain_correlated_under_concurrent_requests() {
        let (client_to_server_tx, client_to_server_rx) = mpsc::channel();
        let (server_to_client_tx, server_to_client_rx) = mpsc::channel();
        let rpc = Arc::new(RpcClient::new(
            ChannelWriter {
                tx: client_to_server_tx,
            },
            ChannelReader::new(server_to_client_rx),
        ));

        let server = thread::spawn(move || {
            let mut requests = Vec::new();
            for _ in 0..12 {
                let raw = client_to_server_rx.recv().expect("request bytes");
                let line = String::from_utf8(raw).expect("utf8");
                let value: serde_json::Value =
                    serde_json::from_str(line.trim()).expect("json request");
                requests.push(value);
            }

            for request in requests.into_iter().rev() {
                let id = request
                    .get("id")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap();
                let n = request
                    .get("params")
                    .and_then(|v| v.get("n"))
                    .cloned()
                    .unwrap();
                let response = json!({"id": id, "result": {"n": n}});
                let mut encoded = serde_json::to_string(&response).expect("serialize");
                encoded.push('\n');
                server_to_client_tx
                    .send(encoded.into_bytes())
                    .expect("send response");
            }
        });

        let mut workers = Vec::new();
        for n in 0..12 {
            let rpc = Arc::clone(&rpc);
            workers.push(thread::spawn(move || {
                let response = rpc
                    .request("test/echo", json!({"n": n}), Duration::from_secs(2))
                    .expect("response");
                match response {
                    RpcResponsePayload::Result(value) => {
                        assert_eq!(value, json!({"n": n}));
                    }
                    RpcResponsePayload::Error(error) => {
                        panic!("unexpected error payload: {error:?}");
                    }
                }
            }));
        }

        for worker in workers {
            worker.join().expect("worker join");
        }
        server.join().expect("server join");
    }

    #[test]
    fn malformed_jsonl_line_is_emitted_and_stream_continues() {
        let (client_to_server_tx, _client_to_server_rx) = mpsc::channel();
        let (server_to_client_tx, server_to_client_rx) = mpsc::channel();
        let rpc = RpcClient::new(
            ChannelWriter {
                tx: client_to_server_tx,
            },
            ChannelReader::new(server_to_client_rx),
        );

        server_to_client_tx
            .send(b"{\"broken\":\n".to_vec())
            .expect("send malformed");
        server_to_client_tx
            .send(b"{\"method\":\"turn/started\",\"params\":{\"ok\":true}}\n".to_vec())
            .expect("send notification");

        let first = rpc
            .recv_event_timeout(Duration::from_secs(1))
            .expect("event result")
            .expect("event");
        assert!(matches!(first, RpcEvent::MalformedLine { .. }));

        let second = rpc
            .recv_event_timeout(Duration::from_secs(1))
            .expect("event result")
            .expect("event");
        assert_eq!(
            second,
            RpcEvent::Notification {
                method: "turn/started".to_string(),
                params: json!({"ok": true}),
            }
        );
    }
}
