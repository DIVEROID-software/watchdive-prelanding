import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/api/reservation/direct')({server:{handlers:{POST:async ({request}) => {
  const {handleDirectReservation} = await import('@/lib/reservation/direct');
  return handleDirectReservation(request);
}}}});
