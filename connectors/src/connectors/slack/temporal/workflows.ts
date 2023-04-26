import { executeChild, proxyActivities } from "@temporalio/workflow";

import { DataSourceConfig } from "../../../types/data_source_config";
import { getWeekEnd, getWeekStart } from "../lib/utils";
import type * as activities from "./activities";
import { saveSuccessSyncActivity } from "./activities";

const {
  getChannels,
  getMessagesForChannel,
  syncThreads,
  syncMultipleNoNThreaded,
  getAccessToken,
  fetchUsers,
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "1 minute",
});

export async function workspaceFullSync(
  dataSourceConfig: DataSourceConfig,
  nangoConnectionId: string
): Promise<void> {
  const slackAccessToken = await getAccessToken(nangoConnectionId);
  await fetchUsers(slackAccessToken);
  const channels = await getChannels(slackAccessToken);
  for (const channel of channels) {
    await executeChild(workspaceSyncOneChannel.name, {
      args: [nangoConnectionId, dataSourceConfig, channel.id, channel.name],
    });
  }
  saveSuccessSyncActivity(dataSourceConfig);
}

export async function workspaceSyncOneChannel(
  nangoConnectionId: string,
  dataSourceConfig: DataSourceConfig,
  channelId: string,
  channelName: string,
  messagesCursor?: string
) {
  const threadsToSync: string[] = [];
  const unthreadedTimeframesToSync = new Map<
    string,
    { startTsMs: number; endTsMs: number }
  >();

  const slackAccessToken = await getAccessToken(nangoConnectionId);
  // const counter = 0;
  do {
    const messages = await getMessagesForChannel(
      slackAccessToken,
      channelId as string,
      100,
      messagesCursor
    );
    if (!messages.messages) {
      // This should never happen because we throw an exception in the activity if we get an error
      // from the Slack API, but we need to make typescript happy.
      break;
    }
    for (const message of messages.messages) {
      if (message.thread_ts) {
        if (threadsToSync.indexOf(message.thread_ts) === -1) {
          // We can end up getting two messages from the same thread if a message from a thread has also been "posted to channel".
          threadsToSync.push(message.thread_ts);
        }
      } else {
        const messageTs = parseInt(message.ts as string, 10) * 1000;
        const weekStartTsMs = getWeekStart(new Date(messageTs)).getTime();
        const weekEndTsMss = getWeekEnd(new Date(messageTs)).getTime();

        unthreadedTimeframesToSync.set(`${weekStartTsMs}-${weekEndTsMss}`, {
          startTsMs: weekStartTsMs,
          endTsMs: weekEndTsMss,
        });
      }
    }
    console.log("sync threaded", new Date());
    await syncThreads(
      dataSourceConfig,
      slackAccessToken,
      channelId,
      threadsToSync
    );
    threadsToSync.length = 0;
    console.log("sync non threaded", new Date());

    messagesCursor = messages.response_metadata?.next_cursor;
  } while (messagesCursor);
  await syncMultipleNoNThreaded(
    slackAccessToken,
    dataSourceConfig,
    channelId,
    channelName,
    Array.from(unthreadedTimeframesToSync.values())
  );
}
