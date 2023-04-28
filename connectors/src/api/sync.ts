import { Request, Response } from "express";

import { launchSlackSyncWorkflow } from "@connectors/connectors/slack/temporal/client";
import { ConnectorsAPIErrorResponse } from "@connectors/types/errors";

type GetSyncStatusRes = { workflowId: string } | ConnectorsAPIErrorResponse;

export const syncApiHandler = async (
  req: Request<{ connector_id: string }, GetSyncStatusRes, undefined>,
  res: Response<GetSyncStatusRes>
) => {
  const launchRes = await launchSlackSyncWorkflow(req.params.connector_id);
  if (launchRes.isErr()) {
    res.status(500).send({
      error: {
        message: launchRes.error.message,
      },
    });
    return;
  }

  return res.status(200).send({
    workflowId: launchRes.value,
  });
};
