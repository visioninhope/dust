import {
  getPagesEditedSince,
  getParsedPage,
} from "@connectors/connectors/notion/lib/notion_api";
import { getTagsForPage } from "@connectors/connectors/notion/lib/tags";
import {
  deleteFromDatasource,
  upsertToDatasource,
} from "@connectors/lib/datasource_api";
import { Connector, NotionPage, sequelize_conn } from "@connectors/lib/models";
import { nango_client } from "@connectors/lib/nango_client";
import { DataSourceConfig } from "@connectors/types/data_source_config";

export async function notionGetPagesToSyncActivity(
  accessToken: string,
  lastSyncedAt: number | null
): Promise<string[]> {
  return getPagesEditedSince(accessToken, lastSyncedAt);
}

export async function notionUpsertPageActivity(
  accessToken: string,
  pageId: string,
  dataSourceConfig: DataSourceConfig
) {
  const transaction = await sequelize_conn.transaction();

  try {
    const connector = await Connector.findOne({
      where: {
        type: "notion",
        workspaceId: dataSourceConfig.workspaceId,
        dataSourceName: dataSourceConfig.dataSourceName,
      },
      transaction,
    });

    if (!connector) {
      throw new Error("Could not find connector");
    }

    const existingNotionPage = await NotionPage.findOne({
      where: {
        notionPageId: pageId,
      },
      transaction,
    });

    if (!existingNotionPage) {
      await NotionPage.create({
        notionPageId: pageId,
        connectorId: connector.id,
      });
    }

    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }

  const parsedPage = await getParsedPage(accessToken, pageId);
  await upsertToDatasource(
    dataSourceConfig,
    `notion-${parsedPage.id}`,
    parsedPage.rendered,
    parsedPage.url,
    parsedPage.createdTime,
    getTagsForPage(parsedPage)
  );
}

export async function saveSuccessSyncActivity(
  dataSourceConfig: DataSourceConfig
) {
  const transaction = await sequelize_conn.transaction();

  try {
    const connector = await Connector.findOne({
      where: {
        type: "notion",
        workspaceId: dataSourceConfig.workspaceId,
        dataSourceName: dataSourceConfig.dataSourceName,
      },
    });

    if (!connector) {
      throw new Error("Could not find connector");
    }

    const now = new Date();

    await connector.update({
      lastSyncStatus: "succeeded",
      lastSyncFinishTime: now,
      lastSyncSuccessfulTime: now,
    });

    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
}

export async function saveStartSyncActivity(
  dataSourceConfig: DataSourceConfig
) {
  const transaction = await sequelize_conn.transaction();

  try {
    const connector = await Connector.findOne({
      where: {
        type: "notion",
        workspaceId: dataSourceConfig.workspaceId,
        dataSourceName: dataSourceConfig.dataSourceName,
      },
    });

    if (!connector) {
      throw new Error("Could not find connector");
    }

    await connector.update({
      lastSyncStartTime: new Date(),
    });

    await transaction.commit();
  } catch (e) {
    await transaction.rollback();
    throw e;
  }
}

export async function getNotionAccessTokenActivity(
  nangoConnectionId: string
): Promise<string> {
  const { NANGO_NOTION_CONNECTOR_ID } = process.env;

  if (!NANGO_NOTION_CONNECTOR_ID) {
    throw new Error("NANGO_NOTION_CONNECTOR_ID not set");
  }

  const notionAccessToken = (await nango_client().getToken(
    NANGO_NOTION_CONNECTOR_ID,
    nangoConnectionId
  )) as string;

  return notionAccessToken;
}

export async function findNewAndDeletedPagesActivity(
  dataSourceConfig: DataSourceConfig,
  nangoConnectionId: string
): Promise<{ newPages: string[]; deletedPages: string[] }> {
  const { NANGO_NOTION_CONNECTOR_ID } = process.env;

  if (!NANGO_NOTION_CONNECTOR_ID) {
    throw new Error("NANGO_NOTION_CONNECTOR_ID not set");
  }

  const notionAccessToken = (await nango_client().getToken(
    NANGO_NOTION_CONNECTOR_ID,
    nangoConnectionId
  )) as string;
  const notionPageIdsInNotion = new Set(
    await getPagesEditedSince(notionAccessToken, null)
  );

  const connector = await Connector.findOne({
    where: {
      type: "notion",
      workspaceId: dataSourceConfig.workspaceId,
      dataSourceName: dataSourceConfig.dataSourceName,
    },
  });
  if (!connector) {
    throw new Error("Could not find connector");
  }
  const notionPageIdsInDb = new Set(
    (
      await NotionPage.findAll({
        where: {
          connectorId: connector.id,
        },
        attributes: ["notionPageId"],
      })
    ).map((p) => p.notionPageId)
  );

  const pagesToDelete = Array.from(notionPageIdsInDb).filter(
    (x) => !notionPageIdsInNotion.has(x)
  );
  const missingPages = Array.from(notionPageIdsInNotion).filter(
    (x) => !notionPageIdsInDb.has(x)
  );

  return {
    newPages: missingPages,
    deletedPages: pagesToDelete,
  };
}

export async function notionDeletePageActivity(
  pageId: string,
  dataSourceConfig: DataSourceConfig
) {
  await deleteFromDatasource(dataSourceConfig, `notion-${pageId}`);
}
