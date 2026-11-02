import type { Metadata, Viewport } from "next";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import SkipLink from "@/components/SkipLink";
import { elapsedMs, getRequestContext, getRequestLogger } from "@/lib/request-context";
import "./globals.scss";

// Render every route on the server at request time (no static prerendering,
// no data cache). Child segments inherit this setting.
export const dynamic = "force-dynamic";

const SERVICE_NAME = "Hello World";
const THEME_COLOUR = "#005eb8"; // NHS Blue

export const metadata: Metadata = {
  title: {
    default: `${SERVICE_NAME} - NHS`,
    template: `%s - ${SERVICE_NAME} - NHS`,
  },
  description: "A hello world application built with Next.js and the NHS design system.",
  manifest: "/assets/manifest.json",
  icons: {
    icon: [
      { url: "/assets/images/favicon.ico", sizes: "48x48" },
      { url: "/assets/images/favicon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    apple: "/assets/images/nhsuk-icon-180.png",
    other: [
      { rel: "mask-icon", url: "/assets/images/nhsuk-icon-mask.svg", color: THEME_COLOUR },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: THEME_COLOUR,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Matches the NHS.UK frontend page template: flags JS support before paint so
// components (e.g. the header menu) render in their enhanced state without a flash.
const jsEnabledScript =
  "document.body.className += ' js-enabled' + ('noModule' in HTMLScriptElement.prototype ? ' nhsuk-frontend-supported' : '');";

// NHS.UK frontend JavaScript (header menu, skip link focus handling, etc.) is
// loaded as a plain ES module straight from /assets/js, exactly as the
// design system's own page template does. It runs in the browser after the
// server-rendered HTML arrives; no React client component is involved.
const NHS_FRONTEND_JS = "/assets/js/nhsuk-frontend.min.js";
const initNhsFrontendScript = `import { initAll } from "${NHS_FRONTEND_JS}"; initAll();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getRequestContext();
  const log = await getRequestLogger();
  // Time from the proxy seeing the request to the page tree starting to render.
  // Full response timing comes from the trace (step 2) and CloudFront logs.
  log.info({ event: "page.render", elapsedMs: elapsedMs(ctx) });

  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: jsEnabledScript }} />
        <SkipLink />
        <Header
          serviceName={SERVICE_NAME}
          navigation={[
            { href: "/", text: "Home", current: true },
            { href: "/#about", text: "About this app" },
          ]}
        />
        <div className="nhsuk-width-container">
          <main className="nhsuk-main-wrapper" id="maincontent">
            {children}
          </main>
        </div>
        <Footer
          navigation={[
            {
              heading: "NHS design system",
              items: [
                { href: "https://service-manual.nhs.uk/design-system", text: "Design system" },
                { href: "https://service-manual.nhs.uk/design-system/styles", text: "Styles" },
                { href: "https://service-manual.nhs.uk/design-system/components", text: "Components" },
                { href: "https://service-manual.nhs.uk/design-system/patterns", text: "Patterns" },
              ],
            },
            {
              heading: "Service manual",
              items: [
                { href: "https://service-manual.nhs.uk/", text: "NHS service manual" },
                { href: "https://service-manual.nhs.uk/accessibility", text: "Accessibility" },
                { href: "https://service-manual.nhs.uk/content", text: "Content guide" },
              ],
            },
            {
              heading: "Code",
              items: [
                { href: "https://github.com/nhsuk/nhsuk-frontend", text: "nhsuk-frontend on GitHub" },
                { href: "https://nextjs.org/docs", text: "Next.js documentation" },
              ],
            },
          ]}
          meta={[
            { href: "/#about", text: "About this app" },
          ]}
        />
        {/* Module scripts are deferred by the HTML spec; the rule only knows about classic scripts. */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script type="module" src={NHS_FRONTEND_JS} />
        <script type="module" dangerouslySetInnerHTML={{ __html: initNhsFrontendScript }} />
      </body>
    </html>
  );
}
