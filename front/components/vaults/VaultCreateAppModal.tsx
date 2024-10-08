import {
  ExclamationCircleStrokeIcon,
  Input,
  Modal,
  Page,
  RadioButton,
  TextArea,
} from "@dust-tt/sparkle";
import type { APIError, AppVisibility, WorkspaceType } from "@dust-tt/types";
import { useRouter } from "next/router";
import { useContext, useState } from "react";

import { SendNotificationsContext } from "@app/components/sparkle/Notification";
import { useApps } from "@app/lib/swr/apps";
import { MODELS_STRING_MAX_LENGTH } from "@app/lib/utils";
import type { PostAppResponseBody } from "@app/pages/api/w/[wId]/apps";

export const VaultCreateAppModal = ({
  owner,
  isOpen,
  setIsOpen,
}: {
  owner: WorkspaceType;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}) => {
  const router = useRouter();
  const sendNotification = useContext(SendNotificationsContext);

  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<AppVisibility>("private");

  const [errors, setErrors] = useState<{
    name: string | null;
    description: string | null;
  }>({
    name: null,
    description: null,
  });

  const { apps, mutateApps } = useApps(owner);

  const onSave = async () => {
    let nameError: string | null = null;
    let descriptionError: string | null = null;

    if (!name || name.trim() === "") {
      nameError = "Name is required.";
    } else if (!name.match(/^[a-zA-Z0-9._-]+$/)) {
      nameError =
        "Name must only contain letters, numbers, and the characters `._-`";
    } else if (apps.find((app) => app.name === name)) {
      nameError = "An App with this name already exists.";
    }

    if (!description || description.trim() === "") {
      descriptionError =
        "A description is required for your app to be selectable in the Assistant Builder.";
    }

    setErrors({
      name: nameError,
      description: descriptionError,
    });

    if (name && description && !nameError && !descriptionError) {
      const res = await fetch(`/api/w/${owner.sId}/apps`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.slice(0, MODELS_STRING_MAX_LENGTH),
          description: description.slice(0, MODELS_STRING_MAX_LENGTH),
          visibility,
        }),
      });
      if (res.ok) {
        await mutateApps();
        const response: PostAppResponseBody = await res.json();
        const { app } = response;
        await router.push(`/w/${owner.sId}/a/${app.sId}`);
        setIsOpen(false);

        sendNotification({
          type: "success",
          title: "Successfully created app",
          description: "App was successfully created.",
        });
      } else {
        const err: { error: APIError } = await res.json();
        sendNotification({
          title: "Error Saving App",
          type: "error",
          description: `Error: ${err.error.message}`,
        });
      }
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setIsOpen(false);
      }}
      onSave={onSave}
      hasChanged={name !== null || description !== null}
      title="Create a new App"
      variant="side-sm"
    >
      <Page variant="modal">
        <div className="w-full">
          <Page.Vertical sizing="grow">
            <Page.SectionHeader title="Name" />
            <div className="w-full">
              <Input
                placeholder="app_name"
                name="name"
                value={name}
                onChange={(value) => {
                  setName(value);
                  if (errors.name) {
                    setErrors({ ...errors, name: null });
                  }
                }}
                error={errors.name}
                showErrorLabel
              />
              <p className="mt-1 flex items-center gap-1 text-sm text-gray-500">
                <ExclamationCircleStrokeIcon /> Must be unique and not use
                spaces or special characters.
              </p>
            </div>

            <Page.Separator />
            <Page.SectionHeader title="Description" />
            <div className="w-full">
              <TextArea
                placeholder="This description guides assistants in understanding how to use
                your app effectively and determines its relevance in responding to user inquiries."
                value={description}
                onChange={(value) => {
                  setDescription(value);
                  if (errors.description) {
                    setErrors({ ...errors, description: null });
                  }
                }}
                error={errors.description}
                showErrorLabel
              />
            </div>
            <Page.Separator />
            <Page.SectionHeader title="Visibility" />
            <RadioButton
              name="visibility"
              className="s-flex-col"
              choices={[
                {
                  label: "Private",
                  value: "private",
                  disabled: false,
                },
                {
                  label: "Public",
                  value: "public",
                  disabled: false,
                },
              ]}
              value={visibility}
              onChange={(v) => {
                setVisibility(v as AppVisibility);
              }}
            />
            <div className="mt-4 space-y-4">
              <p className="text-sm text-gray-500">
                <b>Private: </b> Only builders of your workspace can see and
                edit the app.
              </p>
              <p className="text-sm text-gray-500">
                <b>Public: </b> Anyone on the Internet with the link can see the
                app. Only builders of your workspace can edit.
              </p>
            </div>
          </Page.Vertical>
        </div>
      </Page>
    </Modal>
  );
};
