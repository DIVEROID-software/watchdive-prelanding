import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Use — Watch Dive" },
      { name: "description", content: "Terms of Use for the Watch Dive pre-launch page, operated by OceanWick Inc." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <article className="mx-auto max-w-3xl px-5 py-16 sm:py-24">
        <Link to="/" className="text-sm text-primary underline-offset-4 hover:underline">← Back to home</Link>
        <h1 className="mt-6 text-4xl font-bold sm:text-5xl">Terms of Use — Watch Dive Pre-Launch</h1>
        <p className="mt-3 text-sm text-muted-foreground"><strong>Effective date:</strong> June 21, 2026</p>

        <div className="prose-content mt-10 space-y-6 text-base leading-relaxed text-foreground/90">
          <p>
            Welcome to the Watch Dive pre-launch page, operated by OceanWick Inc. ("we", "us", "DIVEROID").
            By using this page and signing up, you agree to the following terms.
          </p>

          <Section title="1. What this page is">
            <p>
              This page lets you register your interest in Watch Dive and receive updates about our upcoming
              Kickstarter campaign. <strong>It is not a store.</strong> No purchase is made and no payment is taken here.
            </p>
          </Section>

          <Section title="2. Pre-launch information">
            <p>
              Watch Dive is still in development. All details shown here — including features, compatibility,
              specifications, pricing (such as the early-bird price), and the launch date — are provided for
              information only and <strong>may change</strong> before or during the Kickstarter campaign.
              Signing up does not reserve a unit or guarantee a specific price.
            </p>
          </Section>

          <Section title="3. Email and SMS updates">
            <p>
              By submitting your email (and optionally your phone number), you agree to receive launch and
              marketing updates from us. You can unsubscribe at any time using the link in any email, or by
              contacting us. How we handle your data is described in our{" "}
              <Link to="/privacy" className="text-primary underline underline-offset-4">Privacy Policy</Link>.
            </p>
          </Section>

          <Section title="4. Intellectual property">
            <p>
              All content on this page — including the Watch Dive and DIVEROID names, logos, text, images,
              and videos — belongs to OceanWick Inc. or its licensors. You may not copy or reuse it without
              our permission.
            </p>
          </Section>

          <Section title="5. Disclaimer">
            <p>
              Watch Dive is a dive aid designed to work with a compatible smartwatch. When released, it is
              intended to support — not replace — proper dive training, certification, and a backup dive
              computer. Always dive within your training and follow safe diving practices.
            </p>
            <p>
              This page is provided "as is" without warranties of any kind. We are not liable for any damages
              arising from your use of this page.
            </p>
          </Section>

          <Section title="6. Governing law">
            <p>These terms are governed by the laws of the Republic of Korea.</p>
          </Section>

          <Section title="7. Contact">
            <p>Questions? Email <a className="text-primary underline underline-offset-4" href="mailto:help@diveroid.com">help@diveroid.com</a>.</p>
          </Section>

          <hr className="border-border" />
          <p className="text-sm italic text-muted-foreground">
            OceanWick Inc. · 145 Dosan-daero, Gangnam-gu, Seoul, Republic of Korea · Business registration no. 716-81-03722
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