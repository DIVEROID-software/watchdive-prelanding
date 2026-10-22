// Isolated QA preview: real production TierList and stylesheet, fake counts.
// No router, credentials, network source, mailer or server function is mounted.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { TierList } from '../src/components/referral/TierList';
import '../src/styles.css';
const query = new URLSearchParams(location.search);
const locale = query.get('locale') === 'ko' ? 'ko' : 'en';
const credited = query.get('count') === 'unknown' ? null : Number(query.get('count') ?? 3);
document.documentElement.lang = locale;
createRoot(document.getElementById('root')!).render(<TierList locale={locale} credited={credited} />);
