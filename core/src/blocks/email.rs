use crate::blocks::block::{parse_pair, replace_variables_in_string, Block, BlockType, Env};
use crate::Rule;
use anyhow::{anyhow, Result};
use async_trait::async_trait;
use imap::ClientBuilder;
use js_sandbox::Script;
use pest::iterators::Pair;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Error {
    pub error: String,
}

#[derive(Clone)]
pub struct Email {
    mailbox: String,
    search_query: String,
    fetch_query: String,
    limit: Option<usize>,
}

impl Email {
    pub fn parse(block_pair: Pair<Rule>) -> Result<Self> {
        let mut mailbox: Option<String> = None;
        let mut search_query: Option<String> = None;
        let mut fetch_query: Option<String> = None;
        let mut limit: Option<usize> = None;

        for pair in block_pair.into_inner() {
            match pair.as_rule() {
                Rule::pair => {
                    let (key, value) = parse_pair(pair)?;
                    match key.as_str() {
                        "mailbox" => mailbox = Some(value),
                        "search_query" => search_query = Some(value),
                        "fetch_query" => fetch_query = Some(value),
                        "limit" => match value.parse::<usize>() {
                            Ok(n) => limit = Some(n),
                            Err(_) => Err(anyhow!(
                                "Invalid `limit` in `email` block, expecting integer"
                            ))?,
                        },
                        _ => Err(anyhow!("Unexpected `{}` in `email` block", key))?,
                    }
                }
                Rule::expected => Err(anyhow!("`expected` is not yet supported in `email` block"))?,
                _ => unreachable!(),
            }
        }

        if !mailbox.is_some() {
            Err(anyhow!("Missing required `mailbox` in `email` block"))?;
        }
        if !search_query.is_some() {
            Err(anyhow!("Missing required `search_query` in `email` block"))?;
        }
        if !fetch_query.is_some() {
            Err(anyhow!("Missing required `fetch_query` in `email` block"))?;
        }

        Ok(Email {
            mailbox: mailbox.unwrap(),
            search_query: search_query.unwrap(),
            fetch_query: fetch_query.unwrap(),
            limit,
        })
    }
}

#[async_trait]
impl Block for Email {
    fn block_type(&self) -> BlockType {
        BlockType::Email
    }

    fn inner_hash(&self) -> String {
        let mut hasher = blake3::Hasher::new();
        hasher.update("email".as_bytes());
        hasher.update(self.mailbox.as_bytes());
        hasher.update(self.search_query.as_bytes());
        hasher.update(self.fetch_query.as_bytes());
        if self.limit.is_some() {
            hasher.update(self.limit.unwrap().to_string().as_bytes());
        }
        format!("{}", hasher.finalize().to_hex())
    }

    async fn execute(&self, name: &str, env: &Env) -> Result<Value> {
        let config = env.config.config_for_block(name);

        let query = replace_variables_in_string(&self.search_query, "search_query", env)?;

        let imap_server = match env.credentials.get("EMAIL_IMAP_SERVER") {
            Some(s) => Ok(s.clone()),
            None => match std::env::var("EMAIL_IMAP_SERVER") {
                Ok(s) => Ok(s),
                Err(_) => Err(anyhow!(
                    "Credentials or environment variable `EMAIL_IMAP_SERVER` is not set."
                )),
            },
        }?;

        let imap_port = match env.credentials.get("EMAIL_IMAP_PORT") {
            Some(p) => Ok(p.clone()),
            None => match std::env::var("EMAIL_IMAP_PORT") {
                Ok(p) => Ok(p),
                Err(_) => Err(anyhow!(
                    "Credentials or environment variable `EMAIL_IMAP_PORT` is not set."
                )),
            },
        }?;

        let imap_user = match env.credentials.get("EMAIL_IMAP_USER") {
            Some(u) => Ok(u.clone()),
            None => match std::env::var("EMAIL_IMAP_USER") {
                Ok(u) => Ok(u),
                Err(_) => Err(anyhow!(
                    "Credentials or environment variable `EMAIL_IMAP_USER` is not set."
                )),
            },
        }?;

        let request = HttpRequest::new(
            "GET",
            format!(
                "https://serpapi.com/search?q={}&engine={}&api_key={}",
                encode(&query),
                self.engine,
                serp_api_key
            )
            .as_str(),
            json!({}),
            Value::Null,
        )?;

        let response = request
            .execute_with_cache(env.project.clone(), env.store.clone(), use_cache)
            .await?;

        match response.status {
            200 => Ok(response.body),
            s => Err(anyhow!(
                "SerpAPIError: Unexpected error with HTTP status {}.",
                s
            )),
        }

        let e = env.clone();

        let headers_code = self.headers_code.clone();
        let headers_value: Value = match tokio::task::spawn_blocking(move || {
            let mut script = Script::from_string(headers_code.as_str())?
                .with_timeout(std::time::Duration::from_secs(10));
            script.call("_fun", (&e,))
        })
        .await?
        {
            Ok(v) => v,
            Err(e) => Err(anyhow!("Error in headers code: {}", e))?,
        };

        let e = env.clone();
        let body_code = self.body_code.clone();
        let body_value: Value = match tokio::task::spawn_blocking(move || {
            let mut script = Script::from_string(body_code.as_str())?
                .with_timeout(std::time::Duration::from_secs(10));
            script.call("_fun", (&e,))
        })
        .await?
        {
            Ok(v) => v,
            Err(e) => Err(anyhow!("Error in body code: {}", e))?,
        };

        let url = replace_variables_in_string(&self.url, "url", env)?;

        let request = HttpRequest::new(
            self.method.as_str(),
            url.as_str(),
            headers_value,
            body_value,
        )?;

        let response = request
            .execute_with_cache(env.project.clone(), env.store.clone(), use_cache)
            .await?;

        Ok(json!(response))
    }

    fn clone_box(&self) -> Box<dyn Block + Sync + Send> {
        Box::new(self.clone())
    }

    fn as_any(&self) -> &dyn std::any::Any {
        self
    }
}
