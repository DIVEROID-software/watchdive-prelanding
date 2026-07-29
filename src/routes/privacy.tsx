import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Watch Dive" },
      {
        name: "description",
        content:
          "How OceanWick Inc. handles your information when you sign up for Watch Dive pre-launch updates.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
        <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">
          ← Back to home
        </Link>
        <h1 className="mt-6 text-4xl font-bold sm:text-5xl">
          Privacy Policy — Watch Dive Pre-Launch
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          <strong>Effective date:</strong> July 30, 2026
        </p>

        <div className="mt-10 space-y-6 text-base leading-relaxed text-foreground/90">
          <p>
            This Privacy Policy explains how OceanWick Inc. ("we", "us", "DIVEROID") handles your
            information when you sign up on the Watch Dive pre-launch page to receive updates about
            our upcoming Kickstarter campaign.
          </p>
          <p>
            This page is for collecting launch interest only. It is not a store and does not process
            any payment.
          </p>

          <Section title="1. Who we are">
            <ul className="list-disc space-y-1 pl-6">
              <li>
                <strong>Company:</strong> OceanWick Inc. (오션윅 주식회사)
              </li>
              <li>
                <strong>Representative:</strong> Jay Kim
              </li>
              <li>
                <strong>Address:</strong> 1114, 145 Dosan-daero, Gangnam-gu, Seoul 06036, Republic
                of Korea
              </li>
              <li>
                <strong>Business registration no.:</strong> 716-81-03722
              </li>
              <li>
                <strong>Privacy contact:</strong> help@diveroid.com
              </li>
            </ul>
          </Section>

          <Section title="2. What we collect">
            <ul className="list-disc space-y-1 pl-6">
              <li>
                <strong>Email address</strong> (required) — to send the confirmation you request
                and, after you confirm, Watch Dive launch updates.
              </li>
              <li>
                <strong>Phone number</strong> (optional) — only if you choose to receive a VIP SMS
                launch alert.
              </li>
              <li>
                <strong>Security signals</strong> — abuse flags and a short-lived, keyed network
                bucket used in server memory to limit automated or repeated requests. We do not
                retain the raw IP address, the network bucket, or the full browser user-agent in the
                lead record.
              </li>
              <li>
                <strong>Basic usage data</strong> — page visits and device type collected through
                standard web analytics tools where measurement is enabled.
              </li>
            </ul>
            <p>We do not collect payment details on this page.</p>
          </Section>

          <Section title="3. Why we use it">
            <p>We use the information you provide to:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>send a one-time link to confirm that you control the email address;</li>
              <li>send you a notification when Watch Dive launches on Kickstarter;</li>
              <li>share early-bird pricing and launch-related updates;</li>
              <li>protect the form and our email delivery service from abuse;</li>
              <li>understand how the page performs so we can improve it.</li>
            </ul>
            <p>We will not use your information for unrelated purposes.</p>
          </Section>

          <Section title="4. Legal basis">
            <p>
              Submitting the form requests an operational confirmation email. Your waitlist
              registration and consent to launch updates are completed only after you use the
              confirmation link. You can withdraw your consent at any time (see Section 7).
            </p>
          </Section>

          <Section title="5. Sharing and international transfer">
            <p>
              We use trusted service providers to operate this page and send confirmations or
              updates — for example transactional email and SMS delivery services, web hosting, and
              analytics providers. These providers may store data on servers located outside Korea,
              including in the United States. We only share what is necessary for them to provide
              their service, and we never sell your personal information.
            </p>
          </Section>

          <Section title="6. How long we keep it">
            <p>
              We keep your information until the Watch Dive launch campaign ends or until you ask us
              to delete it or unsubscribe — whichever comes first. After that, we delete it without
              undue delay.
            </p>
          </Section>

          <Section title="7. Your rights">
            <p>You can at any time:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>ask what information we hold about you;</li>
              <li>ask us to correct or delete it;</li>
              <li>unsubscribe from emails (via the link in any email we send) or SMS;</li>
              <li>withdraw your consent.</li>
            </ul>
            <p>
              To exercise any of these rights, email{" "}
              <a
                className="text-primary underline underline-offset-4"
                href="mailto:help@diveroid.com"
              >
                help@diveroid.com
              </a>
              .
            </p>
          </Section>

          <Section title="8. Children">
            <p>
              This page is not intended for children under 14, and we do not knowingly collect
              information from them.
            </p>
          </Section>

          <Section title="9. Changes to this policy">
            <p>
              We may update this Privacy Policy from time to time. The latest version will always be
              available on this page, with the effective date shown at the top.
            </p>
          </Section>

          <Section title="10. Contact">
            <p>
              Questions about your privacy? Email{" "}
              <a
                className="text-primary underline underline-offset-4"
                href="mailto:help@diveroid.com"
              >
                help@diveroid.com
              </a>
              .
            </p>
          </Section>

          <hr className="border-border" />
          <p className="text-sm italic text-muted-foreground">
            OceanWick Inc. · 145 Dosan-daero, Gangnam-gu, Seoul, Republic of Korea
          </p>
        </div>
      </article>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-xl font-semibold sm:text-2xl">{title}</h2>
      {children}
    </section>
  );
}
