import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/api/social-kit-report')({server:{handlers:{GET:async({request})=>{const {handleSocialKitReport}=await import('@/lib/socialKitReport.server.ts');return handleSocialKitReport(request);}}}});
