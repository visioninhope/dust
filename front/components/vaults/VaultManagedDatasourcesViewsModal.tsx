import { Modal } from "@dust-tt/sparkle";
import type {
  DataSourceViewSelectionConfigurations,
  DataSourceViewType,
  VaultType,
  WorkspaceType,
} from "@dust-tt/types";
import type { SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DataSourceViewsSelector } from "@app/components/data_source_view/DataSourceViewSelector";
import { useMultipleDataSourceViewsContentNodes } from "@app/lib/swr/data_source_views";

export default function VaultManagedDataSourcesViewsModal({
  vault,
  isOpen,
  setOpen,
  owner,
  systemVaultDataSourceViews,
  onSave,
  initialSelectedDataSources,
}: {
  vault: VaultType;
  isOpen: boolean;
  setOpen: (isOpen: boolean) => void;
  owner: WorkspaceType;
  systemVaultDataSourceViews: DataSourceViewType[];
  onSave: (
    selectionConfigurations: DataSourceViewSelectionConfigurations
  ) => void;
  initialSelectedDataSources: DataSourceViewType[];
}) {
  const dataSourceViewsAndInternalIds = useMemo(
    () =>
      initialSelectedDataSources.map((dsv) => ({
        dataSourceView: dsv,
        internalIds: dsv.parentsIn ?? [],
      })),
    [initialSelectedDataSources]
  );

  const initialConfigurations = useMultipleDataSourceViewsContentNodes({
    dataSourceViewsAndInternalIds,
    owner,
    viewType: "documents",
  });

  const [selectionConfigurations, setSelectionConfigurations] =
    useState<DataSourceViewSelectionConfigurations>({});

  const [hasChanged, setHasChanged] = useState(false);

  useEffect(() => {
    if (
      !initialConfigurations.isNodesLoading &&
      !initialConfigurations.isNodesError
    ) {
      const converted = initialConfigurations.dataSourceViewsAndNodes.reduce(
        (acc, config) => {
          const isSelectAll = config.dataSourceView.parentsIn === null;
          const selectedResources = isSelectAll ? [] : config.nodes;

          // We are selecting from the system data source views to create / edit a vault data source view.
          // The initialSelectedDataSources represents the current selection.
          // Here, we must remap to the system view that corresponds to the non system vault data source view.
          const systemDataSourceView =
            systemVaultDataSourceViews.find(
              (dsv) =>
                // TODO(DATASOURCE_SID): move to sId
                dsv.dataSource.name === config.dataSourceView.dataSource.name
            ) ?? config.dataSourceView; // Fallback to make sure we are never undefined

          acc[systemDataSourceView.sId] = {
            dataSourceView: systemDataSourceView,
            selectedResources,
            isSelectAll,
          };
          return acc;
        },
        {} as DataSourceViewSelectionConfigurations
      );
      setSelectionConfigurations(converted);
    }
  }, [initialConfigurations, systemVaultDataSourceViews]);

  const setSelectionConfigurationsCallback = useCallback(
    (func: SetStateAction<DataSourceViewSelectionConfigurations>) => {
      setHasChanged(true);
      setSelectionConfigurations(func);
    },
    [setSelectionConfigurations]
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setOpen(false);
      }}
      onSave={() => {
        onSave(selectionConfigurations);
        setOpen(false);
      }}
      hasChanged={hasChanged}
      variant="side-md"
      title={`Add connected datasources to vault "${vault.name}"`}
    >
      <div className="w-full pt-12">
        <div className="overflow-x-auto">
          <DataSourceViewsSelector
            dataSourceViews={systemVaultDataSourceViews}
            owner={owner}
            selectionConfigurations={selectionConfigurations}
            setSelectionConfigurations={setSelectionConfigurationsCallback}
            viewType="documents"
          />
        </div>
      </div>
    </Modal>
  );
}
