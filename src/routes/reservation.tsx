import { createFileRoute, useRouterState } from "@tanstack/react-router";

import { ReservationPage } from "@/components/reservation/ReservationPage";
import { PRODUCT_PRICE_USD, RESERVATION_FEE_USD } from "@/components/reservation/pricing";
import { reservationLangBootstrapScript } from "@/components/reservation/query";

export const Route = createFileRoute("/reservation")({
  head: () => ({
    meta: [
      { title: "WatchDive reservation" },
      {
        name: "description",
        content: `Pay the additional ${RESERVATION_FEE_USD} WatchDive reservation fee. It is not credited toward the ${PRODUCT_PRICE_USD} product price.`,
      },
      { name: "referrer", content: "no-referrer" },
      { name: "robots", content: "noindex, nofollow, noarchive" },
    ],
    scripts: [{ children: reservationLangBootstrapScript() }],
  }),
  component: ReservationRoute,
});

function ReservationRoute() {
  const search = useRouterState({ select: (state) => state.location.searchStr });
  return <ReservationPage search={search} />;
}
