import {
  WorkflowExecutionDescription,
  WorkflowHandle,
  WorkflowNotFoundError,
} from "@temporalio/client";

import { queueName } from "@connectors/connectors/notion/temporal/config";
import {
  getLastSyncPeriodTsQuery,
  notionSyncWorkflow,
} from "@connectors/connectors/notion/temporal/workflows";
import { errorFromAny } from "@connectors/lib/error";
import { getTemporalClient } from "@connectors/lib/temporal";
import logger from "@connectors/logger/logger";
import {
  DataSourceConfig,
  DataSourceInfo,
} from "@connectors/types/data_source_config";

function getWorkflowId(dataSourceConfig: DataSourceInfo) {
  return `workflow-notion-${dataSourceConfig.workspaceId}-${dataSourceConfig.dataSourceName}`;
}

export async function launchNotionSyncWorkflow(
  dataSourceConfig: DataSourceConfig,
  nangoConnectionId: string,
  startFromTs: number | null = null,
  forceStartFromScratch = false
) {
  if (startFromTs && forceStartFromScratch) {
    throw new Error(
      "Cannot specify both startFromTs and forceStartFromScratch"
    );
  }

  const client = await getTemporalClient();

  const existingWorkflowStatus = await getNotionConnectionStatus(
    dataSourceConfig
  );

  if (
    existingWorkflowStatus &&
    existingWorkflowStatus.status &&
    existingWorkflowStatus.status.status.name === "RUNNING"
  ) {
    logger.warn(
      {
        workspaceId: dataSourceConfig.workspaceId,
      },
      "Notion sync workflow already running"
    );
    return;
  }

  let lastSyncedPeriodTs: number | null = null;

  if (existingWorkflowStatus.status) {
    if (!forceStartFromScratch) {
      lastSyncedPeriodTs = existingWorkflowStatus.lastSyncPeriodTs;
    }

    await stopWorkflow(dataSourceConfig);
  }

  await client.workflow.start(notionSyncWorkflow, {
    args: [
      dataSourceConfig,
      nangoConnectionId,
      startFromTs || lastSyncedPeriodTs || undefined,
    ],
    taskQueue: queueName,
    workflowId: getWorkflowId(dataSourceConfig),
  });

  logger.info(
    { workspaceId: dataSourceConfig.workspaceId },
    "Started Notion sync workflow"
  );
}

export async function stopNotionSyncWorkflow(
  dataSourceConfig: DataSourceInfo
): Promise<void> {
  const existingWorkflowStatus = await getNotionConnectionStatus(
    dataSourceConfig
  );

  if (
    existingWorkflowStatus &&
    existingWorkflowStatus.status &&
    existingWorkflowStatus.status.status.name !== "RUNNING"
  ) {
    logger.warn(
      {
        workspaceId: dataSourceConfig.workspaceId,
      },
      "Notion sync workflow is not running"
    );
    return;
  }

  if (!existingWorkflowStatus.status) {
    logger.warn(
      {
        workspaceId: dataSourceConfig.workspaceId,
      },
      "Notion sync workflow not found"
    );
    return;
  }

  await stopWorkflow(dataSourceConfig);

  logger.info(
    { workspaceId: dataSourceConfig.workspaceId },
    "Terminated Notion sync workflow"
  );
}

export async function getNotionConnectionStatus(
  dataSourceInfo: DataSourceInfo
): Promise<{
  status: WorkflowExecutionDescription | null;
  lastSyncPeriodTs: number | null;
}> {
  const client = await getTemporalClient();

  const handle: WorkflowHandle<typeof notionSyncWorkflow> =
    client.workflow.getHandle(getWorkflowId(dataSourceInfo));

  try {
    const execStatusRes = await handle.describe();
    let lastSyncPeriodTsRes: number | null = null;
    try {
      lastSyncPeriodTsRes = await handle.query(getLastSyncPeriodTsQuery);
    } catch (e) {
      logger.warn(
        {
          workspaceId: dataSourceInfo.workspaceId,
          dataSourceName: dataSourceInfo.dataSourceName,
          error: errorFromAny(e),
        },
        "Failed to get last sync period ts for notion sync workflow"
      );
    }

    return {
      status: execStatusRes,
      lastSyncPeriodTs: lastSyncPeriodTsRes,
    };
  } catch (e) {
    if (e instanceof WorkflowNotFoundError) {
      logger.warn(
        {
          workspaceId: dataSourceInfo.workspaceId,
          dataSourceName: dataSourceInfo.dataSourceName,
          error: errorFromAny(e),
        },
        "Notion sync workflow not found"
      );
      return {
        status: null,
        lastSyncPeriodTs: null,
      };
    }

    throw e;
  }
}

async function stopWorkflow(dataSourceInfo: DataSourceInfo) {
  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(getWorkflowId(dataSourceInfo));
  logger.info(
    {
      workspaceId: dataSourceInfo.workspaceId,
      dataSourceName: dataSourceInfo.dataSourceName,
    },
    `Stopping workflow`
  );

  logger.info(
    {
      workspaceId: dataSourceInfo.workspaceId,
      dataSourceName: dataSourceInfo.dataSourceName,
    },
    "Attempting to cancel workflow"
  );

  try {
    await handle.cancel();
    logger.info(
      {
        workspaceId: dataSourceInfo.workspaceId,
        dataSourceName: dataSourceInfo.dataSourceName,
      },
      "Workflow successfully cancelled"
    );
    return;
  } catch (e) {
    logger.warn(
      {
        workspaceId: dataSourceInfo.workspaceId,
        dataSourceName: dataSourceInfo.dataSourceName,
        error: errorFromAny(e),
      },
      "Failed to cancel workflow"
    );
  }

  logger.info(
    {
      workspaceId: dataSourceInfo.workspaceId,
      dataSourceName: dataSourceInfo.dataSourceName,
    },
    "Attempting to terminate workflow"
  );

  await handle.terminate();

  logger.info(
    {
      workspaceId: dataSourceInfo.workspaceId,
      dataSourceName: dataSourceInfo.dataSourceName,
    },
    "Workflow successfully terminated"
  );
}
