import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc/react";
import { Badge, Button, Switch } from "@calcom/ui";

import { TroubleshooterListItemContainer } from "./TroubleshooterListItemContainer";

const SELECTION_COLORS = ["#f97316", "#84cc16", "#06b6d4", "#8b5cf6", "#ec4899", "#f43f5e"];

interface CalendarToggleItemProps {
  title: string;
  subtitle: string;
  colorDot?: string;
  status: "connected" | "not_found";
  calendars?: {
    active?: boolean;
    name?: string;
  }[];
}
function CalendarToggleItem(props: CalendarToggleItemProps) {
  const badgeStatus = props.status === "connected" ? "green" : "orange";
  const badgeText = props.status === "connected" ? "Connected" : "Not found";
  return (
    <TroubleshooterListItemContainer
      title={props.title}
      subtitle={props.subtitle}
      prefixSlot={
        <>
          <div
            className="h-4 w-4 self-center rounded-[4px]"
            style={{
              backgroundColor: props.colorDot,
            }}
          />
        </>
      }
      suffixSlot={
        <div>
          <Badge variant={badgeStatus} withDot size="sm">
            {badgeText}
          </Badge>
        </div>
      }>
      <div className="[&>*]:text-emphasis flex flex-col gap-3">
        {props.calendars?.map((calendar) => {
          return <Switch key={calendar.name} checked={calendar.active} label={calendar.name} disabled />;
        })}
      </div>
    </TroubleshooterListItemContainer>
  );
}

function EmptyCalendarToggleItem() {
  const { t } = useLocale();

  return (
    <TroubleshooterListItemContainer
      title="Please install a calendar"
      prefixSlot={
        <>
          <div className="h-4 w-4 self-center rounded-[4px] bg-blue-500" />
        </>
      }
      suffixSlot={
        <div>
          <Badge variant="orange" withDot size="sm">
            Not found
          </Badge>
        </div>
      }>
      <div className="flex flex-col gap-3">
        <Button color="secondary" className="justify-center gap-2">
          {t("install_calendar")}
        </Button>
      </div>
    </TroubleshooterListItemContainer>
  );
}

export function CalendarToggleContainer() {
  const { t } = useLocale();
  const { data, isLoading } = trpc.viewer.connectedCalendars.useQuery();

  const hasConnectedCalendars = data && data?.connectedCalendars.length > 0;

  return (
    <div className="flex flex-col space-y-3">
      <p className="text-sm font-medium leading-none">{t("calendars_were_checking_for_conflicts")}</p>
      {hasConnectedCalendars && !isLoading ? (
        <>
          {data.connectedCalendars.map((calendar, idx) => {
            const foundPrimary = calendar.calendars?.find((item) => item.primary);
            return (
              <CalendarToggleItem
                key={calendar.credentialId}
                title={calendar.integration.name}
                colorDot={SELECTION_COLORS[idx] || "#000000"}
                subtitle={foundPrimary?.name ?? "Nameless Calendar"}
                status={calendar.error ? "not_found" : "connected"}
                calendars={calendar.calendars?.map((item) => {
                  return {
                    active: item.isSelected,
                    name: item.name,
                  };
                })}
              />
            );
          })}
          <Button color="secondary" className="justify-center gap-2">
            {t("manage_calendars")}
          </Button>
        </>
      ) : (
        <EmptyCalendarToggleItem />
      )}
    </div>
  );
}
