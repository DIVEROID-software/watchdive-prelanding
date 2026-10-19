import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/api/cron/manual-verification-20261019')({server:{handlers:{POST:async({request})=>{
  const {handleManualCampaign}=await import('@/lib/verification/manualCampaign20261019.server');
  return handleManualCampaign(request);
}}}});
