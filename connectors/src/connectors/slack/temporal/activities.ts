import { WebClient } from "@slack/web-api";
import { Message } from "@slack/web-api/dist/response/ConversationsHistoryResponse";
import { ConversationsHistoryResponse } from "@slack/web-api/dist/response/ConversationsHistoryResponse";
import {
  Channel,
  ConversationsListResponse,
} from "@slack/web-api/dist/response/ConversationsListResponse";
import { ConversationsRepliesResponse } from "@slack/web-api/dist/response/ConversationsRepliesResponse";
import axios, { AxiosRequestConfig } from "axios";

import { syncSucceeded } from "@connectors/connectors/sync_status";
import { cacheGet, cacheSet } from "@connectors/lib/cache";
import { nango_client } from "@connectors/lib/nango_client";
import { DataSourceConfig } from "@connectors/types/data_source_config";

const { FRONT_API, NANGO_SLACK_CONNECTOR_ID } = process.env;

// This controls the maximum number of concurrent calls to syncThread and syncNonThreaded.
const MAX_CONCURRENCY_LEVEL = 20;

/**
 * Slack API rate limit TLDR:
 * Slack has different rate limits for different endpoints.
 * Tier 1: ~1 request per minute
 * Tier 2: ~20 request per minute (conversations.history)
 * Tier 3: ~50 request per minute
 * 

 */

export async function getChannels(
  slackAccessToken: string
): Promise<Channel[]> {
  const client = new WebClient(slackAccessToken);
  const allChannels = [];
  let nextCursor: string | undefined = undefined;
  do {
    const c: ConversationsListResponse = await client.conversations.list({
      types: "public_channel",
      limit: 1000,
      cursor: nextCursor,
    });
    nextCursor = c?.response_metadata?.next_cursor;
    if (c.error) {
      throw new Error(c.error);
    }
    if (!c.channels) {
      throw new Error(
        "There was no channels in the response for cursor " +
          c?.response_metadata?.next_cursor +
          ""
      );
    }
    for (const channel of c.channels) {
      if (channel && channel.id && channel.is_member) {
        allChannels.push(channel);
      }
    }
  } while (nextCursor);

  return allChannels;
}

export async function getMessagesForChannel(
  slackAccessToken: string,
  channelId: string,
  limit = 100,
  nextCursor?: string
): Promise<ConversationsHistoryResponse> {
  const client = new WebClient(slackAccessToken);

  const c: ConversationsHistoryResponse = await client.conversations.history({
    channel: channelId,
    limit: limit,
    cursor: nextCursor,
  });
  if (c.error) {
    throw new Error(
      `Failed getting messages for channel ${channelId}: ${c.error}`
    );
  }
  console.log("We got messages for channel ${channelId}", c.messages?.length);
  return c;
}

export async function syncMultipleNoNThreaded(
  slackAccessToken: string,
  dataSourceConfig: DataSourceConfig,
  channelId: string,
  channelName: string,
  timestampsMs: { startTsMs: number; endTsMs: number }[],
  connectorId: string
) {
  while (timestampsMs.length > 0) {
    const _timetampsMs = timestampsMs.splice(0, MAX_CONCURRENCY_LEVEL);

    await Promise.all(
      _timetampsMs.map((t) =>
        syncNonThreaded(
          slackAccessToken,
          dataSourceConfig,
          channelId,
          channelName,
          t.startTsMs,
          t.endTsMs,
          connectorId
        )
      )
    );
  }
}

export async function syncNonThreaded(
  slackAccessToken: string,
  dataSourceConfig: DataSourceConfig,
  channelId: string,
  channelName: string,
  startTsMs: number,
  endTsMs: number,
  connectorId: string
) {
  const client = new WebClient(slackAccessToken);
  const nextCursor: string | undefined = undefined;
  const messages: Message[] = [];

  const startTsSec = Math.round(startTsMs / 1000);
  const endTsSec = Math.round(endTsMs / 1000);

  const c: ConversationsHistoryResponse = await client.conversations.history({
    channel: channelId,
    limit: 300,
    oldest: `${startTsSec}`,
    latest: `${endTsSec}`,
    cursor: nextCursor,
  });

  if (c.error) {
    throw new Error(
      `Failed getting messages for channel ${channelId}: ${c.error}`
    );
  }
  if (c.messages === undefined) {
    throw new Error(
      `Failed getting messages for channel ${channelId}: messages is undefined`
    );
  }
  for (const message of c.messages) {
    if (!message.user) {
      continue;
    }
    if (!message.thread_ts) {
      messages.push(message);
    }
  }
  const text = await formatMessagesForUpsert(
    channelId,
    messages,
    connectorId,
    client
  );

  const startDate = new Date(startTsMs);
  const endDate = new Date(endTsMs);
  const startDateStr = `${startDate.getFullYear()}-${startDate.getMonth()}-${startDate.getDate()}`;
  const endDateStr = `${endDate.getFullYear()}-${endDate.getMonth()}-${endDate.getDate()}`;
  const documentId = `${channelName}-nonthreaded-${startDateStr}-${endDateStr}`;
  const firstMessage = messages[0];
  let sourceUrl: string | undefined = undefined;
  const createdAt = firstMessage?.ts
    ? parseInt(firstMessage.ts, 10) * 1000
    : undefined;
  if (firstMessage && firstMessage.ts) {
    const linkRes = await client.chat.getPermalink({
      channel: channelId,
      message_ts: firstMessage.ts,
    });
    if (linkRes.ok && linkRes.permalink) {
      sourceUrl = linkRes.permalink;
    }
  }

  await upsertToDatasource(
    dataSourceConfig,
    documentId,
    text,
    sourceUrl,
    createdAt
  );

  return c;
}

export async function syncThreads(
  dataSourceConfig: DataSourceConfig,
  slackAccessToken: string,
  channelId: string,
  threadsTs: string[],
  connectorId: string
) {
  while (threadsTs.length > 0) {
    const _threadsTs = threadsTs.splice(0, MAX_CONCURRENCY_LEVEL);
    await Promise.all(
      _threadsTs.map((t) =>
        syncThread(
          dataSourceConfig,
          slackAccessToken,
          channelId,
          t,
          connectorId
        )
      )
    );
  }
}

export async function syncThread(
  dataSourceConfig: DataSourceConfig,
  slackAccessToken: string,
  channelId: string,
  threadTs: string,
  connectorId: string
) {
  const client = new WebClient(slackAccessToken);

  let allMessages: Message[] = [];
  const { channel } = await client.conversations.info({
    channel: channelId,
  });
  if (!channel) {
    throw new Error("Channel not found for id " + channelId);
  }

  let next_cursor = undefined;

  do {
    const replies: ConversationsRepliesResponse =
      await client.conversations.replies({
        channel: channelId,
        ts: threadTs,
        cursor: next_cursor,
      });
    if (replies.error) {
      throw new Error(replies.error);
    }
    if (!replies.messages) {
      break;
    }
    allMessages = allMessages.concat(replies.messages.filter((m) => !!m.user));
    next_cursor = replies.response_metadata?.next_cursor;
  } while (next_cursor);

  const text = await formatMessagesForUpsert(
    channelId,
    allMessages,
    connectorId,
    client
  );
  const documentId = `${channel.name}-threaded-${threadTs}`;

  const firstMessage = allMessages[0];
  let sourceUrl: string | undefined = undefined;
  const createdAt = firstMessage?.ts
    ? parseInt(firstMessage.ts, 10) * 1000
    : undefined;
  if (firstMessage && firstMessage.ts) {
    const linkRes = await client.chat.getPermalink({
      channel: channelId,
      message_ts: firstMessage.ts,
    });
    if (linkRes.ok && linkRes.permalink) {
      sourceUrl = linkRes.permalink;
    }
  }

  await upsertToDatasource(
    dataSourceConfig,
    documentId,
    text,
    sourceUrl,
    createdAt
  );
}

async function processMessageForMentions(
  message: string,
  connectorId: string,
  slackClient: WebClient
): Promise<string> {
  const matches = message.match(/<@[A-Z-0-9]+>/g);
  if (!matches) {
    return message;
  }
  for (const m of matches) {
    const userId = m.replace(/<|@|>/g, "");
    const userName = await getUserName(userId, connectorId, slackClient);
    if (!userName) {
      continue;
    }

    message = message.replace(m, userName);

    continue;
  }

  return message;
}

async function formatMessagesForUpsert(
  channelId: string,
  messages: Message[],
  connectorId: string,
  slackClient: WebClient
) {
  return (
    await Promise.all(
      messages.map(async (message) => {
        const text = await processMessageForMentions(
          message.text as string,
          connectorId,
          slackClient
        );

        const userName = await getUserName(
          message.user as string,
          connectorId,
          slackClient
        );
        const messageDate = new Date(parseInt(message.ts as string, 10) * 1000);
        const messageDateStr = formatDateForUpsert(messageDate);

        return `>> @${userName} [${messageDateStr}]:\n ${text}\n`;
      })
    )
  ).join("\n");
}

async function upsertToDatasource(
  dataSourceConfig: DataSourceConfig,
  documentId: string,
  documentContent: string,
  sourceUrl?: string,
  createAt?: number
) {
  console.log(`upsert ${documentId}`);
  const dust_url = `${FRONT_API}/api/v1/w/${dataSourceConfig.workspaceId}/data_sources/${dataSourceConfig.dataSourceName}/documents/${documentId}`;
  const dust_request_payload = {
    text: documentContent,
    sourceUrl: sourceUrl,
    timestamp: createAt,
  };
  const dust_request_config: AxiosRequestConfig = {
    headers: {
      Authorization: `Bearer ${dataSourceConfig.workspaceAPIKey}`,
    },
  };
  const dust_request_result = await axios.post(
    dust_url,
    dust_request_payload,
    dust_request_config
  );
  if (dust_request_result.status >= 200 && dust_request_result.status < 300) {
    return;
  } else {
    throw new Error(
      `Failed to upsert to Dust data source ${dataSourceConfig.dataSourceName}: ${dust_request_result.status} ${dust_request_result.statusText}`
    );
  }
}

export async function fetchUsers(
  slackAccessToken: string,
  connectorId: string
) {
  let cursor: string | undefined;
  const client = new WebClient(slackAccessToken);
  do {
    const res = await client.users.list({});
    if (res.error) {
      throw new Error(`Failed to fetch users: ${res.error}`);
    }
    if (!res.members) {
      throw new Error(`Failed to fetch users: members is undefined`);
    }
    for (const member of res.members) {
      if (member.id && member.real_name) {
        cacheSet(getUserCacheKey(member.id, connectorId), member.real_name);
      }
    }
    cursor = res.response_metadata?.next_cursor;
  } while (cursor);
}

export async function getAccessToken(
  nangoConnectionId: string
): Promise<string> {
  if (!NANGO_SLACK_CONNECTOR_ID) {
    throw new Error("NANGO_SLACK_CONNECTOR_ID is not defined");
  }
  return nango_client().getToken(NANGO_SLACK_CONNECTOR_ID, nangoConnectionId);
}

export async function saveSuccessSyncActivity(connectorId: string) {
  await syncSucceeded(parseInt(connectorId));
}

async function getUserName(
  slackUserId: string,
  connectorId: string,
  slackClient: WebClient
): Promise<string | undefined> {
  const fromCache = await cacheGet(getUserCacheKey(slackUserId, connectorId));
  if (fromCache) {
    return fromCache;
  }

  const info = await slackClient.users.info({ user: slackUserId });

  if (info.user?.real_name) {
    cacheSet(getUserCacheKey(slackUserId, connectorId), info.user.real_name);
    return info.user.real_name;
  }
  return;
}

function getUserCacheKey(userId: string, connectorId: string) {
  return `slack-userid2name-${connectorId}-${userId}`;
}

export function formatDateForUpsert(date: Date) {
  const year = date.getFullYear();
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const day = date.getDate().toString().padStart(2, "0");
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");

  return `${year}${month}${day} ${hours}:${minutes}`;
}
