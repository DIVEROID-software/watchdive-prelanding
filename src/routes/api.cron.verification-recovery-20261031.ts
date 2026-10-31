import { createFileRoute } from '@tanstack/react-router';
export const Route = createFileRoute('/api/cron/verification-recovery-20261031')({ server: { handlers: {
  POST: async ({ request }) => {
    const { handleVerificationRecovery } = await import('@/lib/verification/recovery20261031.server');
    return handleVerificationRecovery(request);
  },
} } });
