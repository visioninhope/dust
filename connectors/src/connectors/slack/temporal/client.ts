import { getTemporalClient } from "@connectors/lib/temporal";
import logger from "@connectors/logger/logger";
import {
  DataSourceConfig,
  DataSourceInfo,
} from "@connectors/types/data_source_config";

import { workspaceFullSync } from "./workflows";

export async function launchSlackSyncWorkflow(
  dataSourceConfig: DataSourceConfig,
  nangoConnectionId: string
) {
  const client = await getTemporalClient();

  const workflowId = getWorkflowId(dataSourceConfig);
  await client.workflow.start(workspaceFullSync, {
    args: [dataSourceConfig, nangoConnectionId],
    taskQueue: "slack-queue",
    workflowId: workflowId,
  });

  logger.info(
    { workspaceId: dataSourceConfig.workspaceId },
    `Started Slac sync workflow with id ${workflowId}`
  );
}

function getWorkflowId(dataSourceConfig: DataSourceInfo) {
  return `workflow-slack-${dataSourceConfig.workspaceId}-${dataSourceConfig.dataSourceName}`;
}
