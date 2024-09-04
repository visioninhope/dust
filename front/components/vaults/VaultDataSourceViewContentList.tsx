import {
  Button,
  DataTable,
  DropdownMenu,
  Searchbar,
  Spinner,
} from "@dust-tt/sparkle";
import type {
  ContentNodesViewType,
  DataSourceViewType,
  PlanType,
  VaultType,
  WorkspaceType,
} from "@dust-tt/types";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { useRef, useState } from "react";

import type {
  ContentActionKey,
  ContentActionsRef,
} from "@app/components/vaults/ContentActions";
import {
  ContentActions,
  getMenuItems,
} from "@app/components/vaults/ContentActions";
import { FoldersHeaderMenu } from "@app/components/vaults/FoldersHeaderMenu";
import { WebsitesHeaderMenu } from "@app/components/vaults/WebsitesHeaderMenu";
import { getVisualForContentNode } from "@app/lib/content_nodes";
import { isFolder, isWebsite } from "@app/lib/data_sources";
import { useDataSourceViewContentNodes } from "@app/lib/swr/data_source_views";
import { classNames } from "@app/lib/utils";

type RowData = {
  internalId: string;
  icon: React.ComponentType;
  title: string;
  expandable: boolean;
  lastUpdatedAt: number | null;
  onClick?: () => void;
};

type VaultDataSourceViewContentListProps = {
  vault: VaultType;
  dataSourceView: DataSourceViewType;
  plan: PlanType;
  isAdmin: boolean;
  onSelect: (parentId: string) => void;
  owner: WorkspaceType;
  parentId?: string;
};

const getTableColumns = (): ColumnDef<RowData>[] => {
  return [
    {
      header: "Name",
      accessorKey: "title",
      id: "title",
      sortingFn: "text", // built-in sorting function case-insensitive
      cell: (info: CellContext<RowData, unknown>) => (
        <DataTable.CellContent icon={info.row.original.icon}>
          <span className="font-bold">{info.row.original.title}</span>
        </DataTable.CellContent>
      ),
    },
  ];
};

export const VaultDataSourceViewContentList = ({
  owner,
  vault,
  dataSourceView,
  plan,
  isAdmin,
  onSelect,
  parentId,
}: VaultDataSourceViewContentListProps) => {
  const [dataSourceSearch, setDataSourceSearch] = useState<string>("");
  const contentActionsRef = useRef<ContentActionsRef>(null);
  const [viewType, setViewType] = useState<ContentNodesViewType>("documents");

  const { isNodesLoading, mutateDataSourceViewContentNodes, nodes } =
    useDataSourceViewContentNodes({
      dataSourceView,
      owner,
      internalIds: parentId ? [parentId] : [],
      includeChildren: true,
      viewType,
    });

  const rows: RowData[] =
    nodes?.map((contentNode) => ({
      ...contentNode,
      icon: getVisualForContentNode(contentNode),
      onClick: () => {
        if (contentNode.expandable) {
          onSelect(contentNode.internalId);
        }
      },
      moreMenuItems: getMenuItems(
        dataSourceView,
        contentNode,
        contentActionsRef
      ),
    })) || [];

  if (isNodesLoading) {
    return (
      <div className="mt-8 flex justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <>
      <div
        className={classNames(
          "flex gap-2",
          rows.length === 0 && isAdmin
            ? "h-36 w-full max-w-4xl items-center justify-center rounded-lg border bg-structure-50"
            : ""
        )}
      >
        {rows.length > 0 && (
          <>
            <Searchbar
              name="search"
              placeholder="Search (Name)"
              value={dataSourceSearch}
              onChange={(s) => {
                setDataSourceSearch(s);
              }}
            />
          </>
        )}
        {isFolder(dataSourceView.dataSource) && (
          <>
            <DropdownMenu>
              <DropdownMenu.Button>
                <Button
                  size="sm"
                  label={viewType === "documents" ? "Documents" : "Tables"}
                  variant="secondary"
                  type="menu"
                />
              </DropdownMenu.Button>

              <DropdownMenu.Items>
                <DropdownMenu.Item
                  label="Documents"
                  onClick={() => setViewType("documents")}
                />
                <DropdownMenu.Item
                  label="Tables"
                  onClick={() => setViewType("tables")}
                />
              </DropdownMenu.Items>
            </DropdownMenu>
            <FoldersHeaderMenu
              owner={owner}
              vault={vault}
              folder={dataSourceView.dataSource}
              contentActionsRef={contentActionsRef}
            />
          </>
        )}
        {isWebsite(dataSourceView.dataSource) && (
          <WebsitesHeaderMenu
            owner={owner}
            vault={vault}
            dataSourceView={dataSourceView}
          />
        )}
      </div>
      {rows.length > 0 && (
        <DataTable
          data={rows}
          columns={getTableColumns()}
          filter={dataSourceSearch}
          filterColumn="title"
          initialColumnOrder={[{ desc: false, id: "title" }]}
        />
      )}
      <ContentActions
        ref={contentActionsRef}
        dataSourceView={dataSourceView}
        owner={owner}
        plan={plan}
        onSave={async (action?: ContentActionKey) => {
          if (action === "DocumentUploadOrEdit") {
            setViewType("documents");
          } else if (action === "TableUploadOrEdit") {
            setViewType("tables");
          }
          await mutateDataSourceViewContentNodes();
        }}
      />
    </>
  );
};
