import {
  createNotionConnector,
  resumeNotionConnector,
  stopNotionConnector,
} from "@connectors/connectors/notion";
import { createSlackConnector } from "@connectors/connectors/slack";
import { Result } from "@connectors/lib/result";
import { ConnectorProvider } from "@connectors/types/connector";
import {
  DataSourceConfig,
  DataSourceInfo,
} from "@connectors/types/data_source_config";

import { launchSlackSyncWorkflow } from "./slack/temporal/client";

type ConnectorCreator = (
  dataSourceConfig: DataSourceConfig,
  nangoConnectionId: string
) => Promise<Result<string, Error>>;

type SyncConnector = (connectorId: string) => Promise<Result<string, Error>>;

export const CREATE_CONNECTOR_BY_TYPE: Record<
  ConnectorProvider,
  ConnectorCreator
> = {
  slack: createSlackConnector,
  notion: createNotionConnector,
};

type ConnectorStopper = (
  dataSourceInfo: DataSourceInfo
) => Promise<Result<string, Error>>;

export const STOP_CONNECTOR_BY_TYPE: Record<
  ConnectorProvider,
  ConnectorStopper
> = {
  slack: async () => {
    throw new Error("Not implemented");
  },
  notion: stopNotionConnector,
};

type ConnectorResumer = (
  dataSourceConfig: DataSourceConfig,
  nangoConnectionId: string
) => Promise<Result<string, Error>>;

export const RESUME_CONNECTOR_BY_TYPE: Record<
  ConnectorProvider,
  ConnectorResumer
> = {
  slack: async () => {
    throw new Error("Not implemented");
  },
  notion: resumeNotionConnector,
};

export const SYNC_CONNECTOR_BY_TYPE: Record<ConnectorProvider, SyncConnector> =
  {
    slack: launchSlackSyncWorkflow,
    notion: () => {
      throw new Error("Not implemented");
    },
  };
