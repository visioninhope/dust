import { WorkflowClient } from "@temporalio/client";

import { workspaceFullSync } from "./workflow.js";

/**
 * Temporal client only here for demo purposes.
 */
export async function slackGetChannelsViaTemporal(
  nangoConnectionId: string
): Promise<void> {
  const client = new WorkflowClient();
  await client.start(workspaceFullSync, {
    workflowId: `getSlackChannelsWorkflow ${new Date().getTime()}`,
    taskQueue: "slack-sync",

    args: [
      nangoConnectionId,
      {
        workspaceAPIKey: "sk-7b541329c7a12df7c8a05d08435efd7d",
        dataSourceName: "managed-slack",
        workspaceId: "8f98bcd506",
      },
    ],
  });
  return;
}
slackGetChannelsViaTemporal("slack-managed-ds-1");
