/**
 * Data Source configuration
 */

import { BaseAction } from "../../../front/lib/api/assistant/actions/index";
import { ModelId } from "../../../shared/model_id";
import { ioTsEnum } from "../../../shared/utils/iots_utils";
import { ConnectorProvider } from "../../data_source";

export const TIME_FRAME_UNITS = [
  "hour",
  "day",
  "week",
  "month",
  "year",
] as const;
export type TimeframeUnit = (typeof TIME_FRAME_UNITS)[number];
export const TimeframeUnitCodec = ioTsEnum<TimeframeUnit>(TIME_FRAME_UNITS);

export type TimeFrame = {
  duration: number;
  unit: TimeframeUnit;
};
export function isTimeFrame(arg: RetrievalTimeframe): arg is TimeFrame {
  return (
    (arg as TimeFrame).duration !== undefined &&
    (arg as TimeFrame).unit !== undefined
  );
}

export type DataSourceFilter = {
  parents: { in: string[]; not: string[] } | null;
};

export type DataSourceConfiguration = {
  workspaceId: string;
  dataSourceId: string;
  dataSourceViewId: string;
  filter: DataSourceFilter;
};

/**
 * Retrieval configuration
 */

// Retrieval specifies a list of data sources (with possible parent filtering, possible "all" data
// sources), a query ("auto" generated by the model "none", no query, `TemplatedQuery`, fixed
// query), a relative time frame ("auto" generated by the model, "none" no time filtering
// `TimeFrame`) which applies to all data sources, and a top_k parameter.
//
// `query` and `relativeTimeFrame` will be used to generate the inputs specification for the model
// in charge of generating the action inputs. The results will be used along with `topK` and
// `dataSources` to query the data.
export type RetrievalQuery = "auto" | "none";
export type RetrievalTimeframe = "auto" | "none" | TimeFrame;
export type RetrievalConfigurationType = {
  id: ModelId;
  sId: string;

  type: "retrieval_configuration";

  dataSources: DataSourceConfiguration[];
  query: RetrievalQuery;
  relativeTimeFrame: RetrievalTimeframe;
  topK: number | "auto";

  name: string;
  description: string | null;
};

/**
 * Retrieval action
 */

export type RetrievalDocumentType = {
  id: ModelId;
  dataSourceWorkspaceId: string;
  dataSourceId: string;
  sourceUrl: string | null;
  documentId: string;
  reference: string; // Short random string so that the model can refer to the document.
  timestamp: number;
  tags: string[];
  score: number | null;
  chunks: {
    text: string;
    offset: number;
    score: number | null;
  }[];
};

type ConnectorProviderDocumentType =
  | Exclude<ConnectorProvider, "webcrawler">
  | "document";

const providerMap: Record<string, ConnectorProviderDocumentType> = {
  "managed-slack": "slack",
  "managed-notion": "notion",
  "managed-google_drive": "google_drive",
  "managed-github": "github",
  "managed-confluence": "confluence",
  "managed-microsoft": "microsoft",
  "managed-intercom": "intercom",
};

const providerRegex = new RegExp(`^(${Object.keys(providerMap).join("|")})`);

export function getProviderFromRetrievedDocument(
  document: RetrievalDocumentType
): ConnectorProviderDocumentType {
  const match = document.dataSourceId.match(providerRegex);
  if (match && match[1]) {
    return providerMap[match[1]];
  }

  return "document";
}

export function getTitleFromRetrievedDocument(
  document: RetrievalDocumentType
): string {
  const provider = getProviderFromRetrievedDocument(document);

  if (provider === "slack") {
    for (const t of document.tags) {
      if (t.startsWith("channelName:")) {
        return `#${t.substring(12)}`;
      }
    }
  }

  for (const t of document.tags) {
    if (t.startsWith("title:")) {
      return t.substring(6);
    }
  }

  if (provider === "document") {
    return `[${document.dataSourceId}] ${document.documentId}`;
  }

  return document.documentId;
}

export interface RetrievalActionType extends BaseAction {
  id: ModelId; // AgentRetrievalAction
  agentMessageId: ModelId; // AgentMessage

  params: {
    relativeTimeFrame: TimeFrame | null;
    query: string | null;
    topK: number;
  };
  functionCallId: string | null;
  functionCallName: string | null;
  documents: RetrievalDocumentType[] | null;
  step: number;
  type: "retrieval_action";
}
